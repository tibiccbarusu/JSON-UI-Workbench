# Publishing JSON UI Workbench

Use the clean public-source archive, not the original r41 archive or historical
results. Extract it, install Node.js 22.14.0 or later, and run:

```sh
npm ci --ignore-scripts
node scripts/release/audit-public.mjs
npm run test:release
npm start
```

In 0.16.1, `npm start` displays CLI help and exits. Launch the unfinished
experimental GUI explicitly with `npm run gui`. See the
[current English user guide](manual/USER_GUIDE_EN.md) for programmatic entry points.
The publisher offers original portions they own or are authorized to license under PolyForm Noncommercial License 1.0.0. It permits use, modification and redistribution for permitted noncommercial purposes, and does not permit commercial purposes. Read [LICENSE.md](../../LICENSE.md) and the [English explanation](../../LICENSE-EN.md). Preserve third-party terms and notices; imported content remains separate. Do not replace the terms, explanations or package license identifier with GitHub templates.

Describe the project as noncommercial source-available software, rather than open source. AI assistance does not establish third-party permission or certify every inherited author's rights.
`private: true` in `package.json` prevents accidental npm publication; it does not
prevent publishing a public GitHub repository.

With GitHub Desktop, add the extracted project as a local repository, create a
repository there if prompted, review and commit the files, then choose **Publish
repository**. Use `jsonui-workbench` as the name and deselect **Keep this code
private** when ready to make it public. Do not overwrite the included README,
ignore rules, or license notice with GitHub templates.

Alternatively, create an empty GitHub repository and run:

```sh
git init -b main
git add .
git status
git commit -m "Initial release of JSON UI Workbench"
git remote add origin https://github.com/YOUR-ACCOUNT/jsonui-workbench.git
git push -u origin main
```

Replace `YOUR-ACCOUNT` with your account name. Use Git's authentication flow;
never commit credentials. Check the Actions result after pushing. For a release,
create tag `v0.16.1`, describe changes and verification limits, and attach the
clean ZIP and its SHA-256 file. The supplied scripts do not publish anything.
The command-line route also requires Git and a configured commit identity.

Do not upload vanilla packs, user reports, screenshots, private logs, node_modules,
or native binaries. Assets are supplied locally by each user. GitHub Pages does
not run the Node server; source publication is not a hosted backend deployment.

See the [Japanese guide](GITHUB_JA.md) for the full workflow,
and [asset policy](ASSET_POLICY.md) for license boundaries. The public packager
creates a new output directory and refuses to overwrite one that already exists.
Audit that generated directory when your working tree contains runtime logs or
private packs. There is no need to delete your local assets to build a release.

Sources checked 2026-09-28:
[GitHub Desktop](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop),
[Git CLI](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github),
[licensing](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).
