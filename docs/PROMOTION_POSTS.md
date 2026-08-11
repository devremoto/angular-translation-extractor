# Promotion posts — ready to paste

Links used everywhere:

- Marketplace: https://marketplace.visualstudio.com/items?itemName=AdilsondeAlmeidaPedro.angular-translation-extractor
- Source: https://github.com/devremoto/angular-translation-extractor
- Demo GIF (hotlink): https://raw.githubusercontent.com/devremoto/angular-translation-extractor/main/assets/usage-demo.gif

Status: **Reddit r/angular — PUBLISHED** → https://www.reddit.com/r/angular/comments/1vl3ouu/

---

## 1. LinkedIn (paste into "Start a post", then attach `assets/usage-demo.gif`)

Adding i18n to an Angular app that never had it is the job everyone postpones. Installing ngx-translate takes five minutes; hunting down every hard-coded string across hundreds of templates takes weeks.

I got tired of doing it by hand on a side project, so I built a VS Code extension that does the whole loop in one right-click.

What it does:
- Scans TS/HTML (including inline templates) for user-facing strings
- Replaces them with translation keys in place
- Generates one JSON per language and auto-translates them (no API key)
- Wires up the ngx-translate loader, main.ts, and a ready-made language selector

Zero configuration: it finds your angular.json, reads sourceRoot, and derives every path from it. Monorepos work untouched. It also refuses to touch what it shouldn't: Angular control-flow blocks, HTML comments, CSS selectors inside querySelectorAll, and strings outside a class.

Free and open source. Feedback and edge cases from real codebases very welcome.

Marketplace: https://marketplace.visualstudio.com/items?itemName=AdilsondeAlmeidaPedro.angular-translation-extractor
Source: https://github.com/devremoto/angular-translation-extractor

#Angular #i18n #VSCode #TypeScript #WebDevelopment

---

## 2. X / Twitter (attach `assets/usage-demo.gif`)

Hard-coded Angular strings → ngx-translate keys, locale JSONs, auto-translation and a language selector.

One right-click. Zero config — it reads your angular.json and derives every path.

Free on the VS Code Marketplace 👇
https://marketplace.visualstudio.com/items?itemName=AdilsondeAlmeidaPedro.angular-translation-extractor

---

## 3. Hacker News — Show HN (https://news.ycombinator.com/submit)

**Title**

Show HN: VS Code extension that automates Angular i18n extraction

**URL**

https://github.com/devremoto/angular-translation-extractor

**Text** (leave empty when submitting a URL; post this as the first comment instead)

I maintain a side project that had hundreds of hard-coded user-facing strings and no i18n. Installing ngx-translate is trivial; migrating the strings is not. So I wrote an extension that does the migration.

One right-click: it scans TS/HTML (including inline @Component templates), replaces strings with translation keys in place, generates a JSON per language, auto-translates them, and wires up the loader plus a language-selector component.

The part I care most about is that it has no path settings. It finds the nearest angular.json, reads the sourceRoot of the project that owns the file you triggered it on, and derives everything else. An earlier version had settings for all of it and they were a constant source of wrong output (paths silently doubling when the workspace was opened one level above the app).

It's also deliberately conservative about what it will not rewrite — Angular control-flow blocks, HTML comments, CSS selectors passed to querySelectorAll, strings outside a class where `this.` cannot compile. Each of those guards exists because it broke something real first.

---

## 4. dev.to article (https://dev.to/new)

**Title**

Automating Angular i18n: from hard-coded strings to ngx-translate in one right-click

**Tags**

angular, i18n, vscode, typescript

**Body** (markdown)

Adding i18n to an Angular app that never had it is one of those jobs everybody postpones. The library part is easy — `ngx-translate` is a five-minute install. The painful part is the other 95%: hunting down every hard-coded string across hundreds of templates and TypeScript files, inventing a key for each one, moving the text into JSON, and then doing it again for every language.

I hit that wall on a side project and got tired of doing it by hand, so I built a VS Code extension that does the whole loop in one right-click.

![Usage demo](https://raw.githubusercontent.com/devremoto/angular-translation-extractor/main/assets/usage-demo.gif)

## What one right-click does

- **Scans** your TS/HTML — including inline `@Component` templates — for user-facing strings
- **Replaces** them in place: `{{ 'APP.HERO.TITLE' | translate }}` in templates, `this.translateService.instant('APP.HERO.TITLE')` in TypeScript
- **Generates** one JSON per language under `assets/i18n`, with nested keys derived from the file path
- **Auto-translates** the other languages (free Google endpoint — no API key, no account)
- **Wires up** ngx-translate: an HttpClient loader, `main.ts` providers, and a ready-made language-selector component

## Why zero configuration matters

The first version of this extension had settings for the source folder, the output folder, the languages file, and `main.ts`. Every one of them was a chance to be wrong — and they were: point the extension at a workspace opened one level above the app, and paths silently doubled up into `frontend/frontend/src/assets/i18n`.

So I deleted all of them. Now the extension reads your project:

1. Find the nearest `angular.json` — searching up from the file you triggered the command on, then down from the opened folder
2. Read the `sourceRoot` of the project that owns that path
3. Derive everything else from it — locales at `<sourceRoot>/assets/i18n`, the languages list, and `main.ts` from the build target

A monorepo with `projects/app/src` works untouched. Open the workspace above your Angular app, below it, or right on it — same result. If there's no `angular.json` anywhere, the command stops with a clear message instead of guessing.

## What it deliberately does NOT touch

An extractor that rewrites your source is only useful if you can trust it. These are all guarded, each because it broke something first:

- **Angular control flow** — the text node `} @else {` is structure, not a string. Extracting it deletes your block delimiters and you get `NG5002` errors hundreds of lines away.
- **HTML comments** — a multi-line comment containing `<style>` or an apostrophe used to get shredded, taking its `-->` with it.
- **CSS selectors in DOM calls** — `querySelectorAll('img, .photo')` is two words, so a naive "is this a sentence?" heuristic happily translated it. Now every string argument of `querySelector`, `closest`, `addEventListener`, `classList.*` and friends is off-limits.
- **Strings outside a class** — `this.translateService` can't compile in a module-level `const`, so those are skipped with a warning rather than replaced.
- **Your existing injection** — if the class already has a `TranslateService` (any name, `inject()` or constructor), it's reused. And the injected member never collides with a member you already declare: a service with its own `translate(id, lang)` method gets `translateService`, not a duplicate identifier.

That last one is decided by a real Babel parse of the class, not a regex — object-literal keys like `translate: this.translate` used to look like class members and trigger false renames.

## Try it

- Marketplace: https://marketplace.visualstudio.com/items?itemName=AdilsondeAlmeidaPedro.angular-translation-extractor
- Source: https://github.com/devremoto/angular-translation-extractor

I'm the author. It's free and open source — if it mangles something in your templates, open an issue with the snippet and I'll add a guard for it. Edge cases from real codebases are exactly what makes this kind of tool trustworthy.
