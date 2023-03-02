const path = require('path')
const fs = require('fs-extra')
const klaw_sync = require('klaw-sync')

const getCacheDir = () => process.env.NOTES_CACHE_PATH || path.resolve(__dirname, '.cache');

const getUserFilename = (login) => `${getCacheDir()}/user-${login}`;

const getCommentsFilename = (pull) => `${getCacheDir()}/${pull.data.base.repo.owner.login}-${pull.data.base.repo.name}-issue-${pull.data.number}-comments`;

const Components = [
  { name: 'libtransmission (All Platforms)', labels: [ 'scope:core', 'scope:3rdparty' ], pulls: [] },
  { name: 'macOS Client', labels: [ 'scope:mac' ], pulls: [] },
  { name: 'Qt Client', labels: [ 'scope:qt' ], pulls: [] },
  { name: 'GTK Client', labels: [ 'scope:gtk' ], pulls: [] },
  { name: 'Web Client', labels: [ 'scope:web' ], pulls: [] },
  { name: 'Daemon', labels: [ 'scope:daemon' ], pulls: [] },
  { name: 'transmission-cli', labels: [ 'scope:cli' ], pulls: [] },
  { name: 'transimssion-edit', labels: [ 'scope:edit' ], pulls: [] },
  { name: 'transmission-remote', labels: [ 'scope:remote' ], pulls: [] },
  { name: 'transmission-create', labels: [ 'scope:create' ], pulls: [] },
  { name: 'transmission-show', labels: [ 'scope:show' ], pulls: [] },
  { name: 'Everything Else', labels: [ 'scope:docs', 'scope:test' ], pulls: [] }
];

const DoNotThank = new Set([
  // too many to credit
  'ckerr',
  'livings124',
  'mikedld',

  // don't thank bots
  'github-actions[bot]',
]);

const NoteTakers = new Set([ ...DoNotThank, 'nevack', 'GaryElshaw' ]);

const IgnoreLabels = new Set([
  'notes:highlight',
  'notes:none',
  'type:fixup',
]);

// When this variable is defined,
// all docs changes will be grouped together with this summary
const AllDocsChangesSummary = 'Updated documentation.';

/// Notes

const NoNotes = 'no-notes';

const NoNotesAliases = new Set([
  'none',
  'none.',
  'no-notes',
  'no-notes.',
]);

// TODO(ckerr): use `data.author_association`?
const loginCanWriteNotes = (login) => NoteTakers.has(login);

function getNotesFromParagraph(text) {
  const prefix = 'notes: ';
  text = text.trim();
  if (!text.toLowerCase().startsWith(prefix)) return undefined;
  const notes = text.substr(prefix.length).trim();
  if (NoNotesAliases.has(notes.toLowerCase())) return NoNotes;
  return notes;
}

function getNotesFromBody(body) {
  if (!body) return undefined;
  for (const paragraph of body.split('\r\n\r\n')) {
    const notes = getNotesFromParagraph(paragraph);
    if (notes) return notes;
  }
  return undefined;
}

function findSummary(pull) {
  if (AllDocsChangesSummary && pull.data.labels.some((label) => label.name === 'scope:docs')) return AllDocsChangesSummary;

  for (const comment of (fs.readJsonSync(getCommentsFilename(pull)).data || []).reverse()) {
    if (!loginCanWriteNotes(comment.user.login)) continue;
    const notes = getNotesFromBody(comment.body);
    if (notes) return notes == NoNotes ? undefined : notes;
  }

  const notes = getNotesFromBody(pull.data.body);
  if (notes) return notes == NoNotes ? undefined : notes;

  return pull.data.title.trim();
}

function getSummary(pull) {
  let summary = findSummary(pull);
  if (!summary) return summary;

  // trim whitespace
  summary = summary.trim();

  // ensure the first character is capitalized
  summary = summary.charAt(0).toUpperCase() + summary.slice(1);

  // ensure the summary ends in a period
  if (!summary.endsWith('.')) summary = summary + '.';

  // past tense
  const replace_starting = (text, oldstr, newstr) => text.startsWith(oldstr + ' ') ? newstr + ' ' + text.substr(oldstr.length + 1) : text;
  summary = replace_starting(summary, 'Add', 'Added');
  summary = replace_starting(summary, 'Bump', 'Bumped');
  summary = replace_starting(summary, 'Change', 'Changed');
  summary = replace_starting(summary, 'Fix', 'Fixed');
  summary = replace_starting(summary, 'Improve', 'Improved');
  summary = replace_starting(summary, 'Remove', 'Removed');
  summary = replace_starting(summary, 'Update', 'Updated');

  return summary;
}

///

function getComponent(pull) {
  for (const label of pull.data.labels) {
    for (const component of Components) {
      if (component.labels.includes(label.name)) {
        return component;
      }
    }
  }
  return Components.at(-1); // Other
}

function getContributors() {
  return new Map(klaw_sync(getCacheDir()) // login -> octokit user object
    .filter((o) => o.path.includes('/user-'))
    .map((o) => fs.readJsonSync(o.path))
    .map((o) => [o.data.login, o]));
}

const formatUser = (user) => user.data.name
  ? `[@${user.data.login} (${user.data.name})](${user.data.html_url})`
  : `[@${user.data.login}](${user.data.html_url})`;

const formatPullNumber = (pull) => `[#${pull.data.number}](${pull.data.html_url})`;

const formatPullNumbers = (pulls) => pulls.map(formatPullNumber).join(', ');

function getPulls() {
  return klaw_sync(getCacheDir())
    .filter((o) => o.path.includes('-pull-'))
    .map((o) => fs.readJsonSync(o.path));
}

function getReviewers(pulls) {
  const reviewers = new Map(); // pull_number -> Set<login>
  klaw_sync(getCacheDir())
    .filter((o) => o.path.endsWith('-reviews'))
    .map((o) => [ Number.parseInt(o.path.match(/issue-(\d+)-reviews/)[1]), fs.readJsonSync(o.path).data ])
    .forEach(([pullnum, reviews]) => reviewers.set(pullnum, new Set(reviews.map((review) => review.user.login))));

  // Anyone who comments in a code review thread shows up here,
  // even if they submitted the PR. It looks weird to credit
  // someone for code review in their own PR, so omit it here
  for (const pull of pulls) {
    const logins = reviewers.get(pull.data.number);
    if (logins) logins.delete(pull.data.user.login);
  }

  return reviewers;
}

// Sorting notes for a section.
// Highlights go first, then sort by type, then by PR number
function compareItemForComponent(entry_1, entry_2) {
  const [summary_1, pulls_1] = entry_1;
  const [summary_2, pulls_2] = entry_2;

  // primary key: sort by rank label
  const LabelSortRankLabels = ['type:docs', 'type:test', 'type:refactor', 'type:ui', 'type:perf', 'type:fix', 'type:feat', 'notes:highlight'];
  const LabelSortRank = (pulls) => pulls.flatMap((pull) => pull.data.labels.map((label) => LabelSortRankLabels.indexOf(label.name))).sort().at(-1);
  const label_rank_1 = LabelSortRank(pulls_1);
  const label_rank_2 = LabelSortRank(pulls_2);
  if (label_rank_1 != label_rank_2) {
    return label_rank_1 > label_rank_2 ? -1 : 1;
  }

  // secondary key: pr number
  const ComparePullsByAge = (a, b) => a.data.number - b.data.number;
  const FirstPull = (pulls) => [...pulls].sort(ComparePullsByAge)[0];
  const first_pr_1 = FirstPull(pulls_1);
  const first_pr_2 = FirstPull(pulls_2);
  return ComparePullsByAge(first_pr_1, first_pr_2);
}

function renderComponent(component) {
  const summary_to_pulls = new Map(); // summary -> Array<pull>
  for (const pull of component.pulls.filter((o) => o.data.labels.every((label) => !IgnoreLabels.has(label.name)))) {
    const summary = getSummary(pull);
    if (!summary) continue;
    if (!summary_to_pulls.has(summary)) summary_to_pulls.set(summary, []);
    summary_to_pulls.get(summary).push(pull);
  }

  if (summary_to_pulls.size === 0) return;

  console.log(`### ${component.name}`);
  console.log('');

  const sorted_entries = [...summary_to_pulls.entries()].sort(compareItemForComponent);
  for (const [summary, pulls] of sorted_entries) {
    console.log(`* ${summary} (${formatPullNumbers(pulls)})`);
  }
  console.log('');
}

function renderComponents() {
  for (const component of Components) {
    renderComponent(component);
  }
}

function renderHighlights(highlights) {
  const summary_to_pulls = new Map(); // summary -> Array<pull>
  for (const pull of highlights) {
    const summary = getSummary(pull);
    if (!summary) continue;
    if (!summary_to_pulls.has(summary)) summary_to_pulls.set(summary, []);
    summary_to_pulls.get(summary).push(pull);
  }

  if (summary_to_pulls.size === 0) return;

  console.log('### Highlights');
  console.log('');
  for (const [summary, pulls] of summary_to_pulls) {
    const component_name = getComponent(pulls[0]).name;
    if (component_name.includes('All Platforms'))
        console.log(`* ${summary} (${formatPullNumbers(pulls)})`);
    else
        console.log(`* ${summary} (${formatPullNumbers(pulls)}, ${component_name})`);
  }
  console.log('');
}

const renderCodeReviews = (pulls) => 'Code review for ' + formatPullNumbers(pulls);

function printThanks(pulls) {
  const reviewers = getReviewers(pulls);
  const contributors = getContributors(pulls);
  if (contributors.size === 0) return;

  console.log('## Thank You!');
  console.log('');
  console.log('Last but certainly not least, a big ***Thank You*** to these people who contributed to this release:');
  console.log('');

  for (const component of Components) {
    const login_pulls = new Map(); // login -> Array<pull>
    for (const pull of component.pulls.filter((pull) => contributors.has(pull.data.user.login))) {
      const { login } = pull.data.user;
      if (!login_pulls.get(login)) login_pulls.set(login, []);
      login_pulls.get(login).push(pull);
    }

    const component_reviewers = new Map(); // login -> Array<pull>
    for (const [pull_number, logins] of reviewers) {
      for (const pull of component.pulls) {
        if (pull.data.number !== pull_number) continue;
        for (const login of logins) {
          if (!component_reviewers.has(login)) component_reviewers.set(login, []);
          component_reviewers.get(login).push(pull);
        }
      }
    }

    const logins = new Set(
      [...login_pulls.keys(), ...component_reviewers.keys()]
        .filter((login) => !DoNotThank.has(login))
        .sort((login1, login2) => login1.localeCompare(login2, undefined, { sensitivity: 'accent' }))
    );

    if (logins.size === 0) continue;

    console.log(`### Contributions to ${component.name}:`);
    console.log('');

    for (const login of logins) {

      const notes_to_prs = new Map(); // Map<String /*note*/, Map<Number, PR>>

      // code review
      const code_review_note = 'Code review';
      for (const pull of (component_reviewers.get(login) || [])) {
        const key = code_review_note;
        if (!notes_to_prs.has(key)) notes_to_prs.set(key, new Map());
        notes_to_prs.get(key).set(pull.data.number, pull);
      }

      // pull requests
      for (const pull of (login_pulls.get(login) || [])) {
        const summary = getSummary(pull);
        if (!summary) continue;
        const key = summary;
        if (!notes_to_prs.has(key)) notes_to_prs.set(key, new Map());
        notes_to_prs.get(key).set(pull.data.number, pull);
      }

      const lines = [];

      for (const [summary, pull_number_to_pull] of notes_to_prs) {
        if (!summary) continue;
        const pulls = [...pull_number_to_pull.values()];
        lines.push(`${summary} (${formatPullNumbers(pulls)})`);
      }

      if (lines.length === 0) continue;

      const user = contributors.get(login);
      if (lines === 1) {
        console.log(`* ${formatUser(user)}: ${lines[0]}`);
      } else {
        console.log(`* ${formatUser(user)}:`);
        for (line of lines) {
          console.log(`  * ${line}`);
        }
      }
    }
    console.log('');
  }
}

async function main () {
  const pulls = getPulls();
  pulls.forEach((pull) => getComponent(pull).pulls.push(pull));

  let key = '--version=';
  let version = process.argv.find((str) => str.startsWith(key))?.substring(key.length);
  if (!version) {
    console.error(`Missing parameter: ${key}foo`);
    return;
  }

  console.log(`# Transmission ${version}`);
  console.log('');
  const highlights = pulls.filter((pull) => pull.data.labels.some((label) => label.name === 'notes:highlight'));

  console.log(`## What's New in ${version}`);
  console.log('');
  renderHighlights(highlights);
  renderComponents();
  printThanks(pulls);
}

if (process.mainModule === module) {
  main().catch((err) => {
    console.error('Error Occurred:', err);
    process.exit(1);
  });
}
