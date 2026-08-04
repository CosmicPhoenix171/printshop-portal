# Stellar Prints

A React, TypeScript, Firebase Authentication, and Firebase Realtime Database portal for a small PLA and PETG 3D-printing business. The frontend deploys to GitHub Pages. Payments are handled in person; the site only tracks balances and transaction history.

## Included

- Customer registration, login, verification email, password reset, and profile
- Model-link print requests
- PLA and PETG color browsing
- Missing-color requests
- Order status, quotes, customer decisions, and order messages
- Customer balance and transaction history
- Administrator order, quote, inventory, color-request, customer, balance, printer, print-queue, and report tools
- Firebase Realtime Database Security Rules
- GitHub Pages deployment workflow
- Standalone USPS Shipping Calculator at `/shipping-calculator/`

## USPS Shipping Calculator

The calculator is a plain HTML/CSS/JavaScript frontend served by the small Express server in `server.js`. USPS credentials stay on the server. It uses the USPS OAuth 2.0 token endpoint and Shipping Options API Version 3; it does not use Web Tools RateV4 or USPS API Versions 1 or 2.

### USPS Developer Portal setup

1. Create or sign in to a USPS Developer Portal account.
2. Create an application for the USPS APIs and request access to the Shipping Options API Version 3 and OAuth 2.0.
3. Copy the application's Consumer Key and Consumer Secret.
4. Copy `.env.example` to `.env` in the project root.
5. Put the values in `USPS_CONSUMER_KEY` and `USPS_CONSUMER_SECRET`. Do not commit `.env` or expose these values in frontend JavaScript.
6. Leave `USPS_MOCK_MODE=false` for real USPS requests.

### Run the calculator

```bash
npm install
npm start
```

Open <http://localhost:3000/shipping-calculator/>. The server caches the OAuth access token until shortly before expiration and logs provider errors without logging credentials.

For interface testing without USPS credentials, explicitly enable mock mode in `.env`:

```env
USPS_MOCK_MODE=true
```

Mock results are labeled in the interface and must not be used for production prices. Set it back to `false` before using live rates. The API validates ZIP codes, weight, and dimensions, rejects invalid packages, prevents concurrent browser submissions, and never displays rates when USPS returns an error or malformed response.

## 1. Create Firebase project

1. Create a Firebase project.
2. Add a Web App.
3. Enable Authentication with Email/Password.
4. Create a Realtime Database.
5. Do not leave the database in test mode.
6. Copy `.env.example` to `.env` and fill in the public Firebase web configuration.

## 2. Install and run

```bash
npm install
npm run dev
```

## 3. Deploy database rules

Install the Firebase CLI, log in, select your project, then deploy rules:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only database
```

You may also paste `database.rules.json` into the Firebase Console Rules editor.

## 4. Create first administrator

1. Register normally through the website.
2. Open Firebase Authentication and copy that user's UID.
3. Open Realtime Database and manually add:

```json
{
  "admins": {
    "PASTE_UID_HERE": true
  }
}
```

The user must log out and log back in after the role is added.

## 5. Add GitHub secrets

In the GitHub repository, open Settings, Secrets and variables, Actions. Add:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

These are Firebase client configuration values. Access control is enforced by Authentication and Realtime Database Rules.

## 6. Enable GitHub Pages

Open repository Settings, Pages, and select GitHub Actions as the source. Push to the `main` branch. The included workflow builds and deploys the site.

## Important operational rules

- Payments are collected in person.
- Never store card or banking details.
- Only administrators can write financial ledger entries.
- A negative customer balance means the customer owes money.
- A positive customer balance means the customer has account credit.
- Customers submit model links because this free version does not use file storage.
- Administrator records are added manually in Firebase.

## Recommended first setup

1. Add your administrator UID.
2. Add PLA and PETG spools from Admin Inventory.
3. In Realtime Database, edit each generated color under `colors/PLA` or `colors/PETG` and set `selectable` to `true`, `availabilityStatus` to `Available`, and `stockLabel` to the desired label.
4. Test with a separate customer account.
