const path = require('path')
const fs = require('fs-extra')
const klaw_sync = require('klaw-sync')

const getCacheDir = () => process.env.NOTES_CACHE_PATH || path.resolve(__dirname, '.cache');

const getUserFilename = (login) => `${getCacheDir()}/user-${login}`;

const getCommentsFilename = (pull) => `${getCacheDir()}/${pull.data.base.repo.owner.login}-${pull.data.base.repo.name}-issue-${pull.data.number}-comments`;

const Components = [
  { name: 'All Platforms', labels: [ 'scope:core', 'scope:3rdparty' ], pulls: [] },
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
  { name: 'Docs', labels: [ 'scope:docs' ], pulls: [] },
  { name: 'Other', labels: [], pulls: [] }
];

const IgnoreLogins = new Set([
  'ckerr',
  'mikedld',
  'livings124',
  'Coeur',
  'nevack',
]);

const IgnoreLabels = new Set([
  'type:fixup',
  'notes:none',
]);

///

const NoNotes = 'no-notes';

const NoNotesAliases = new Set([
  'none',
  'none.',
  'no-notes',
  'no-notes.',
]);

const loginCanWriteNotes = (login) => IgnoreLogins.has(login);

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

function getSummary(pull) {
  for (const comment of (fs.readJsonSync(getCommentsFilename(pull)).data || []).reverse()) {
    if (!loginCanWriteNotes(comment.user.login)) continue;
    const notes = getNotesFromBody(comment.body);
    if (notes) return notes == NoNotes ? undefined : notes;
  }

  const notes = getNotesFromBody(pull.data.body);
  if (notes) return notes == NoNotes ? undefined : notes;

  return pull.data.title.trim();
}

///

function getComponent(pull_request) {
  for (const label of pull_request.data.labels) {
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

const formatUser = (user) => `[@${user.data.login} (${user.data.name})](${user.data.html_url})`;

const formatPullNumber = (pull) => `[#${pull.data.number}](${pull.data.html_url})`;

const formatPullNumbers = (pulls) => pulls.map(formatPullNumber).join(', ');

function getPulls() {
  return klaw_sync(getCacheDir())
    .filter((o) => o.path.includes('-pull-'))
    .map((o) => fs.readJsonSync(o.path));
}

function getReviewers() {
  const reviewers = new Map(); // pull_number -> Set<login>
  klaw_sync(getCacheDir())
    .filter((o) => o.path.endsWith('-reviews'))
    .map((o) => [ Number.parseInt(o.path.match(/issue-(\d+)-reviews/)[1]), fs.readJsonSync(o.path).data ])
    .forEach(([pullnum, reviews]) => reviewers.set(pullnum, new Set(reviews.map((review) => review.user.login))));

  // Anyone who comments in a code review thread shows up here,
  // even if they submitted the PR. It looks weird to credit
  // someone for code review in their own PR, so omit it here
  for (const pull of getPulls()) {
    const logins = reviewers.get(pull.data.number);
    if (logins) logins.delete(pull.data.user.login);
  }

  return reviewers;
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

  console.log(`## ${component.name}\n\n`);
  for (const [summary, pulls] of summary_to_pulls) {
    console.log(`* ${summary} (${formatPullNumbers(pulls)})\n`);
  }
  console.log('\n');
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

  console.log('## Highlights\n\n');
  for (const [summary, pulls] of summary_to_pulls) {
    console.log(`* ${summary} (${formatPullNumbers(pulls)}, ${getComponent(pulls[0]).name})\n`);
  }
  console.log('\n');
}

const renderCodeReviews = (pulls) => 'Code review for ' + formatPullNumbers(pulls);

function printThanks(pulls) {
  const reviewers = getReviewers();
  const contributors = getContributors(pulls);
  if (contributors.size === 0) return;

  console.log('## Thank you\n\n');
  console.log('Last but certainly not least, a big ***Thank You*** to these contributors:\n\n');

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
        .filter((login) => !IgnoreLogins.has(login))
        .sort());

    if (logins.size === 0) continue;

    console.log(`### Contributions to \`${component.name}\`:\n\n`);

    for (const login of logins) {

      const lines = [];
      const reviews = component_reviewers.get(login);
      if (reviews) lines.push(renderCodeReviews(reviews));
      for (const pull of (login_pulls.get(login) || [])) {
        const summary = getSummary(pull);
        if (!summary) continue;
        lines.push(`${summary} ${formatPullNumber(pull)}`);
      }

      const user = contributors.get(login);
      if (lines === 1) {
        console.log(`* ${formatUser(user)}: ${lines[0]}\n`);
      } else {
        console.log(`* ${formatUser(user)}:\n`);
        for (line of lines) {
          console.log(`  * ${line}\n`);
        }
      }
    }
    console.log('\n');
  }
}

async function main () {
  const pulls = getPulls();
  pulls.forEach((pull) => getComponent(pull).pulls.push(pull));

  const highlights = pulls.filter((pull) => pull.data.labels.some((label) => label.name === 'notes:highlight'));
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
