const path = require('path')
const fs = require('fs-extra')
const klaw_sync = require('klaw-sync')

const getCacheDir = () => process.env.NOTES_CACHE_PATH || path.resolve(__dirname, '.cache');

const getUserFilename = (login) => `${getCacheDir()}/user-${login}`;

const Components = [
  { name: 'Core', labels: [ 'scope:core', 'scope:3rdparty' ], pulls: [] },
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
  { name: 'Unknown', labels: [], pulls: [] }
];

const OmitLogins = new Set([
  'ckerr',
  'mikedld',
  'livings124',
  'Coeur',
]);

const IgnoreLabels = new Set([
  'type:refactor',
  'type:fixup'
]);

function getSummary(pull_request) {
  const prefix = 'notes: ';
  const paragraphs = (pull_request.data.body || '').split('\r\n\r\n');
  for (paragraph of paragraphs) {
    if (paragraph.toLocaleLowerCase().startsWith(prefix)) {
      return paragraph.substr(prefix.length).trim();
    }
  }
  return pull_request.data.title.trim();
}

function getComponent(pull_request) {
  for (const label of pull_request.data.labels) {
    for (const component of Components) {
      if (component.labels.includes(label.name)) {
        return component;
      }
    }
  }
  return Components.at(-1); // Unknown
}

function getContributors() {
  return new Map(klaw_sync(getCacheDir()) // login -> octokit user object
    .filter((o) => o.path.includes('/user-'))
    .map((o) => fs.readJsonSync(o.path))
    .map((o) => [o.data.login, o]));
}

const formatUser = (user) => `[@${user.data.login} (${user.data.name})](${user.data.html_url})`;

const formatPull = (pull) => `${getSummary(pull)} ([#${pull.data.number}](${pull.data.html_url}))`;

function getPulls() {
  return klaw_sync(getCacheDir(), { filter: (o) => o.path.includes('-pull-') })
    .map((o) => fs.readJsonSync(o.path))
    .filter((o) => o.data.labels.every((label) => !IgnoreLabels.has(label.name)));
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

function printComponent(component) {
  if (component.pulls.length === 0) return;
  console.log(`## ${component.name}\n\n`);
  component.pulls.forEach((pull) => console.log(`* ${formatPull(pull)}\n`));
  console.log('\n');
}

function printComponents() {
  for (const component of Components) {
    printComponent(component);
  }
}

const renderCodeReviews = (pulls) => 'Code review for ' + pulls.map((pull) => `[#${pull.data.number}](${pull.data.html_url})`).join(', ');

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
        .filter((login) => !MaintainerLogins.has(login))
        .sort());

    if (logins.size === 0) continue;

    console.log(`### Contributions to \`${component.name}\`:\n\n`);

    for (const login of logins) {

      const lines = [];
      const reviews = component_reviewers.get(login);
      if (reviews) lines.push(renderCodeReviews(reviews));
      lines.push(...(login_pulls.get(login) || []).map(formatPull));

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
  for (const pull of pulls) {
    getComponent(pull).pulls.push(pull);
  }

  printComponents();
  printThanks(pulls);
}

if (process.mainModule === module) {
  main().catch((err) => {
    console.error('Error Occurred:', err);
    process.exit(1);
  });
}
