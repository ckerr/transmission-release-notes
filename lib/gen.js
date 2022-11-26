const path = require('path')
const fs = require('fs-extra')
const klaw_sync = require('klaw-sync')

const getCacheDir = () => process.env.NOTES_CACHE_PATH || path.resolve(__dirname, '.cache');

const getUserFilename = (login) => `${getCacheDir()}/transmission-transmission-user-${login}`;

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

const MaintainerLogins = new Set([
  'ckerr',
  'mikedld',
  'livings124'
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

function getContributors(pulls) {
  const contributors = new Map(); // login -> octokit user object
  for (const pull of pulls) {
    const { login } = pull.data.user;
    if (MaintainerLogins.has(login) || contributors.has(login)) continue;
    contributors.set(login, fs.readJsonSync(getUserFilename(login)));
  }
  return contributors;
}

const formatUser = (user) => `[@${user.data.login} (${user.data.name})](${user.data.html_url})`;

const formatPull = (pull) => `${getSummary(pull)} ([#${pull.data.number}](${pull.data.html_url}))`;

function printComponents(pulls) {
  for (const component of Components) {
    if (component.pulls.length === 0) continue;
    console.log(`## ${component.name}\n\n`);
    component.pulls.forEach((pull) => console.log(`* ${formatPull(pull)}\n`));
    console.log('\n');
  }
}

function printThanks(pulls) {
  const contributors = getContributors(pulls);
  if (contributors.size === 0) return;

  console.log('## Thank you\n\n');
  console.log('Last but certainly not least, a big ***Thank You*** to these contributors:\n\n');

  for (const component of Components) {
    const component_contribs = new Map(); // login -> Array<pull>
    for (const pull of component.pulls.filter((pull) => contributors.has(pull.data.user.login))) {
      const { login } = pull.data.user;
      if (!component_contribs.get(login)) component_contribs.set(login, []);
      component_contribs.get(login).push(pull);
    }

    if (component_contribs.size === 0) continue;

    console.log(`### Contributions to \`${component.name}\`:\n\n`);

    for (const login of [...component_contribs.keys()].sort((a, b) => a.localeCompare(b))) {
      const user = contributors.get(login);
      const user_pulls = component_contribs.get(login);
      if (user_pulls.length === 1) {
        console.log(`* ${formatUser(user)}: ${formatPull(user_pulls[0])}\n`);
      } else {
        console.log(`* ${formatUser(user)}:\n`);
        for (pull of user_pulls) {
          console.log(`  * ${formatPull(pull)}\n`);
        }
      }
    }
    console.log('\n');
  }
}

function getPulls() {
  return klaw_sync(getCacheDir(), { filter: (o) => o.path.includes('-pull-') })
    .map((o) => fs.readJsonSync(o.path));
}

async function main () {
  const pulls = getPulls();
  for (const pull of pulls) {
    getComponent(pull).pulls.push(pull);
  }

  printComponents(pulls);
  printThanks(pulls);
}

if (process.mainModule === module) {
  main().catch((err) => {
    console.error('Error Occurred:', err);
    process.exit(1);
  });
}
