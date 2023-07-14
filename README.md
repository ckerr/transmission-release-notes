# transmission-release-notes

I'm putting this up to share with the others since we have a new beta coming Real Soon Now,
but for God's sake don't read the code. I've copied half of it from another project that I
wrote a generator for and haven't done any reconciliation between the old and new code, nor
any cleanup whatsoever, nor anything to make it easy to use. All it does -- barely -- is
generate a draft version of release notes.

## To use this current version:

1. Set the environment variable `GITHUB_TOKEN` to a [personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) generated from the website. This will let you avoid rate limiting while the script scrapes GitHub.
2. Set the environment variable `SRC_DIR` to point to the Transmission source directory (e.g. where the top-level CMakeLists.txt is)
3. Clone this repo and install the deps with `npm install`
4. Run with `npm start -- ` and append a range of git endpoints you're diffing between, and the name of the release to draft, e.g: `npm start -- 4.0.0-beta.1..main --version 4.0.0-beta.2`. This will scrape the GitHub data into a local cache.
5. Run the render script and redirect the output to a file: `npm run render > release-notes.md`

Example use:

```sh
$ cd transmission-release-notes && npm install # setup
$ rm -rf lib/.cache # only needed to pick up new changes, e.g. updated `Notes:` on GitHub
$ GITHUB_TOKEN=redacted SRC_DIR=/path/to/transmission npm start -- 4.0.3..4.0.x --version=4.0.4
$ cat lede | npm run --silent render -- --version=4.0.4 > /tmp/notes.md
$ npx vmd /tmp/notes.md
```

So when preparing a release, keep editing PRs and repeat those last four lines until you're happy with `notes.md`.

## Making better notes:

- Org members can add give a release note to a PR by adding a comment (or by editing the PR body) with a paragraph that starts with `Notes: `. The rest of the text will be used as a summary for the change in the release notes.
- Noteworthy changes should be given the label `notes:highlight`
- Changes that shouldn't be in release notes should be given the label `notes:none` 
- Please capitalize the first word of the note, use past tense, and the sentence with a period. This is to make the collated notes more consistent and readable.
- If there are several related PRs, try to give them the same `Notes:` summary so that they'll be grouped together.
