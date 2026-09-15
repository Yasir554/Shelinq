# Shelinq

Turn any PDF into a scannable QR code and link — free to self-host, no paid hosting or subscriptions required.

## What it does

Shelinq is a free, self-hosted, open-source tool that turns any PDF into a shareable QR code and link. Upload a PDF, and Shelinq gives you back both a QR code and a direct link, ready to print or share however you like.

It's built for anyone who wants their documents accessible online without paying to host them: students sharing notes, teachers distributing handouts, researchers sharing papers, or anyone printing physical material who wants a simple way to connect it to a digital copy.

## Tech Stack

Shelinq is built entirely on free-tier cloud services — no server to maintain, no monthly hosting bill.

- **Cloudflare Workers** — handles all backend logic (uploads, authentication, redirects). Chosen because it's serverless: no server to keep running or pay for when idle, it scales to zero automatically, and the free tier (100,000 requests/day) is generous enough for this kind of project.

- **Cloudflare R2** — stores the actual PDF files. Chosen specifically because R2 has **zero egress fees** — most cloud storage charges you every time a file is downloaded, but R2 doesn't, which matters since PDFs could be scanned and opened many times.

- **Cloudflare D1** — stores book metadata (titles, slugs, status). Chosen because it lives in the same ecosystem as Workers and R2, meaning no separate database service to sign up for or manage — everything is under one Cloudflare account.

- **Firebase Hosting** — hosts the dashboard (the actual webpage you use to manage books). Chosen because it's free, fast, and gives you a real HTTPS URL (`yourproject.web.app`) with zero configuration.

- **Plain HTML, CSS, and JavaScript** (no framework) — the dashboard doesn't use React, Vue, or any build tools. This keeps the project simple to understand, fork, and modify, even for people newer to web development.

**A note on free tiers:** every service above has a generous free tier that comfortably covers personal or small-scale use. If your usage grows significantly beyond free-tier limits (very high traffic, very large storage), you may eventually be billed by Cloudflare or Firebase directly — Shelinq itself doesn't add any cost on top of what these platforms charge.

## Features

- Upload a PDF and get back a QR code and direct link
- Edit a book's title or replace its file without changing the link/QR code
- Delete a book (soft delete — the link shows a "no longer available" page instead of breaking)
- Copy the link or download the QR code as a PNG
- Single-admin password login, protected with JWT-based authentication
- Rate-limited login (prevents brute-force password guessing)
- Fully responsive dashboard — works on desktop, tablet, and mobile
- Free to self-host — no ongoing costs on Shelinq's part

## How it works

1. You upload a PDF and give it a title
2. The Worker generates a unique, readable slug (e.g. `my-book-title`)
3. The PDF is stored in Cloudflare R2
4. The book's info (title, slug, status) is saved in Cloudflare D1
5. You get back a link (`yourworker.workers.dev/b/my-book-title`) and a QR code for it
6. Anyone who visits the link or scans the QR code is served the PDF directly

## Project Structure

```
Shelinq/
├── src/
│   └── index.js          # Cloudflare Worker — handles uploads, auth, and redirects
├── dashboard/
│   ├── index.html        # Dashboard UI
│   ├── style.css         # Dashboard styling
│   └── app.js             # Dashboard logic (login, upload, QR generation, etc.)
├── schema.sql             # Creates the `books` table in D1
├── schema_v2.sql          # Creates the `login_attempts` table (rate limiting)
├── wrangler.toml          # Cloudflare Worker configuration
└── firebase.json          # Firebase Hosting configuration
```


## Setup — Deploy Your Own

### Prerequisites

- [Node.js](https://nodejs.org) installed (v18 or newer recommended)
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A free [Firebase account](https://console.firebase.google.com)

### 1. Clone the repo

```bash
git clone https://github.com/Yasir554/Shelinq.git
cd Shelinq
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up Cloudflare R2 (file storage)

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), go to **R2 Object Storage**
2. Create a bucket (any name you like, e.g. `shelinq-books`)
3. Cloudflare will ask you to "Add R2 subscription to my account" before letting you create a bucket, even on the free tier. This does require adding a payment method, but you will not be charged unless you exceed the generous free monthly limits (10GB storage, 1M Class A operations, 10M Class B operations).

### 4. Set up Cloudflare D1 (database)

1. In the Cloudflare dashboard, go to **D1 SQLite Database**
2. Create a database (e.g. `shelinq-db`)
3. Note the **database ID** shown after creation

### 5. Log in to Wrangler (Cloudflare's CLI)

```bash
npx wrangler login
```

### 6. Configure `wrangler.toml`

Open `wrangler.toml` and update it with your own values:

```toml
name = "your-worker-name"
main = "src/index.js"
compatibility_date = "YYYY-MM-DD"

[[r2_buckets]]
binding = "BOOKS_BUCKET"
bucket_name = "your-bucket-name"

[[d1_databases]]
binding = "DB"
database_name = "your-database-name"
database_id = "your-database-id"
```

Set `compatibility_date` to today's date (the date you're deploying), in `YYYY-MM-DD` format — this tells Cloudflare which version of the Workers runtime to use.

### 7. Create the database tables

```bash
npx wrangler d1 execute your-database-name --remote --file=schema.sql
npx wrangler d1 execute your-database-name --remote --file=schema_v2.sql
```

### 8. Set your secrets

These are private values Cloudflare stores securely — never put them in your code.

First, generate a long random string to use as your `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output — you'll use it in the next step.

Now set both secrets on your deployed Worker:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put JWT_SECRET
```

You'll be prompted to type each value — enter a strong password for `ADMIN_PASSWORD`, and paste the random string you generated for `JWT_SECRET`.

### 9. Create `.dev.vars` for local testing

If you want to test the Worker locally (using `npx wrangler dev`) before deploying, create a file called `.dev.vars` in your project root with the same values:

```
ADMIN_PASSWORD="your-password-here"
JWT_SECRET=your-generated-string-here
```

Wrap `ADMIN_PASSWORD` in quotes if it contains special characters like `#`, `@`, or `!` — some characters (especially `#`) can otherwise be misread as a comment. This file is already listed in `.gitignore`, so it will never be committed to your repo.

### 10. Deploy the Worker

```bash
npx wrangler deploy
```

This will print your live Worker URL, e.g. `https://your-worker-name.yourname.workers.dev` — copy it, you'll need it next.

### 11. Point the dashboard at your Worker

Open `dashboard/app.js` and update the very first line:

```javascript
const API_BASE = "https://your-worker-name.yourname.workers.dev";
```

### 12. Deploy the dashboard to Firebase Hosting

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Install the Firebase CLI:
```bash
   npm install -g firebase-tools
```
3. Log in:
```bash
   firebase login
```
4. Initialize hosting from your project root:
```bash
   firebase init hosting
```
   - Choose "Use an existing project" and select the one you just created
   - Set the public directory to `dashboard`
   - Answer "No" to single-page app rewrites and GitHub auto-deploy
   - If asked to overwrite `index.html`, choose **No**
5. Deploy:
```bash
   firebase deploy --only hosting
```

You'll get a live URL like `https://your-project.web.app` — that's your Shelinq dashboard, live and ready to use.

## Known Limitations

- **File replacement caching:** if you replace a book's PDF file via Edit, the redirect link may briefly continue showing the old file due to browser caching, until the cache clears or you view it in a private/incognito window. A permanent fix (adding a `Cache-Control: no-store` header to the redirect route) is straightforward but not yet applied.
- **Single-admin only:** Shelinq is designed for one admin per deployment, not multiple user accounts. If you need multi-user support, you'll need to extend the authentication system yourself.
- **Soft delete:** deleting a book doesn't erase it from the database — it's marked as "deleted" so the link can still show a friendly "no longer available" message instead of a broken page. The data isn't fully wiped unless removed manually from your Cloudflare D1 database and R2 bucket (via the Cloudflare dashboard or `wrangler d1 execute` commands).


## Future Updates

Shelinq is currently focused on being a simple, free, and self-hosted way to connect physical documents to their digital versions. The current version is intentionally lightweight, but there are several ideas I would like to explore as the project grows.

> *IMPORTANT NOTE: These are ideas, not commitments — Shelinq is a side project, and development happens whenever time allows.*

### Planned & Possible Improvements

* **Scan Analytics**

  * Track how many times each QR code/link has been accessed
  * Show scan activity over time
  * Show the last access time
  * Provide basic, privacy-conscious usage statistics
  * Keep analytics lightweight without turning Shelinq into an invasive tracking platform

* **Better Link & QR Management**

  * Custom slugs
  * Regenerate or download QR codes in additional formats
  * Better link management and previews
  * Optional custom domains
  * Improved handling of QR codes for printed materials

* **Document Management Improvements**

  * Better document previews
  * File size and storage information
  * Improved PDF replacement and caching behavior
  * Bulk management tools
  * Optional permanent deletion of files from R2 and metadata from D1

* **Multi-User Support**

  * Support multiple administrators/users
  * User-specific document management
  * Role-based permissions
  * Shared document libraries for teams, classrooms, or organizations

* **Security & Reliability**

  * Additional authentication options
  * More configurable rate limiting
  * Improved file validation and upload protections
  * Better caching behavior when replacing documents
  * More detailed security documentation
  * Automated testing for critical API and authentication paths

* **Dashboard Improvements**

  * Improved dashboard UX
  * Drag-and-drop uploads
  * Better mobile management
  * Search, filtering, and sorting
  * More useful document status information

* **Deployment Improvements**

  * Make the self-hosting process even easier
  * Improve setup documentation
  * Provide clearer configuration examples
  * Explore one-command or guided deployment options
  * Keep the project compatible with free or very low-cost infrastructure where practical

* **More Storage/Hosting Options**

  * Explore support for additional object-storage providers
  * Reduce dependency on any single cloud provider where practical
  * Keep the architecture modular enough for people to adapt Shelinq to their own infrastructure

* **Testing & Developer Experience**

  * Add automated tests
  * Improve local development and testing workflows
  * Add CI checks
  * Improve contribution documentation
  * Make the codebase easier to extend and fork

### The Bigger Goal

The long-term goal of Shelinq is not to become another platform that charges you for storing and sharing your own documents.

It is to remain **simple, open-source, and self-hostable** while becoming a more capable document publishing and QR management system.

You should be able to take the repository, connect it to your own infrastructure, and run your own instance.

> **Your documents. Your infrastructure. Your links.**


## Acknowledgments

Shelinq uses [qrcode.js](https://davidshimjs.github.io/qrcodejs/) for client-side QR code generation.

## Contributing

Contributions are welcome. If you'd like to fix a bug, improve documentation, or add a feature, feel free to open a pull request. For larger changes, opening an issue first to discuss the idea is appreciated.

You're also welcome to reach out directly — contact details are on my [GitHub profile](https://github.com/Yasir554). I might be busy at times, so responses may take a bit.

## Support

Found a bug or have a question? Open an [issue on GitHub](https://github.com/Yasir554/Shelinq/issues), or reach out via the contact details on my [GitHub profile](https://github.com/Yasir554). If you find Shelinq useful, following [@Yasir554](https://github.com/Yasir554) on GitHub is appreciated too.

## License

This project is open-source and licensed under the [MIT License](LICENSE) — free to use, modify, and distribute, for any purpose, with no warranty.