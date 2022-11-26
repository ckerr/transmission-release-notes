const path = require('path')
const fs = require('fs-extra')
const klaw_sync = require('klaw-sync')

const getCacheDir = () => process.env.NOTES_CACHE_PATH || path.resolve(__dirname, '.cache');

const Components = [
  { name: 'Core', label: 'scope:core', pulls: [] },
  { name: 'macOS Client', label: 'scope:mac', pulls: [] },
  { name: 'Qt Client', label: 'scope:qt', pulls: [] },
  { name: 'GTK Client', label: 'scope:gtk', pulls: [] },
  { name: 'Web Client', label: 'scope:web', pulls: [] },
  { name: 'Daemon', label: 'scope:daemon', pulls: [] },
  { name: 'transmission-cli', label: 'scope:cli', pulls: [] },
  { name: 'transimssion-edit', label: 'scope:edit', pulls: [] },
  { name: 'transmission-remote', label: 'scope:remote', pulls: [] },
  { name: 'transmission-create', label: 'scope:create', pulls: [] },
  { name: 'transmission-show', label: 'scope:show', pulls: [] },
  { name: 'Docs', label: 'scope:docs', pulls: [] },
  { name: 'Unknown', label: '', pulls: [] }
];

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
      if (component.label == label.name) {
        return component;
      }
    }
  }
  return Components.at(-1); // Unknown
}

async function main () {
  const pulls = klaw_sync(getCacheDir(), { filter: (o) => o.path.includes('-pull-') })
    .map((o) => fs.readJsonSync(o.path));
  for (const pull of pulls) {
    getComponent(pull).pulls.push(pull);
  }
  for (const component of Components) {
    if (component.pulls.length === 0) {
      continue;
    }
    console.log(`## ${component.name}\n\n`)
    for (const pull of component.pulls) {
      console.log(`* ${getSummary(pull)} ([#${pull.data.number}](${pull.data.html_url}))\n`);
    }
    console.log('\n');
  }

  const users = new Map();
  for (const pull of pulls) {
    const { html_url, login, url } = pull.data.user;
    if (!users.has(login)) users.set(login, { html_url, login, url, pulls: [] });
    const user = users.get(login);
    user.pulls.push(pull);
  }
  console.log(`## Thanks`);
  for (const [login, user] of users) {
    console.log(`* ${login}`);
  }
}

if (process.mainModule === module) {
  main().catch((err) => {
    console.error('Error Occurred:', err);
    process.exit(1);
  });
}
