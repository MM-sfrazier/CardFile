# Cardfile

Scan business cards with your iPhone camera and keep them in your own contact list. Cards are read **on the phone itself** with the open-source Tesseract text reader, and your contacts and card photos are stored **only on your phone**. There are no accounts, no servers, and no AI or usage charges.

## Put it on your iPhone

Cardfile is a set of files that needs to live at a web address (HTTPS) so Safari can open it with camera access. GitHub Pages hosts it for free. This takes about 10 minutes, once.

1. **Create a free GitHub account** at [github.com](https://github.com) if you don’t have one. Do these steps on a computer; they’re easier there.
2. Click **New repository**. Name it `cardfile`, choose **Public**, and click **Create repository**.
3. On the new repository page, click **uploading an existing file**. Drag in **everything inside this folder**: `index.html`, `app.js`, `parse.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, and the `icons` and `vendor` folders. Click **Commit changes**.
   - Upload the contents, not the folder itself, so `index.html` sits at the top level of the repository.
4. Go to **Settings > Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, choose **main** and **/ (root)**, then click **Save**.
5. Wait a minute or two, then refresh the page. GitHub shows your address, like `https://yourname.github.io/cardfile/`.
6. **On your iPhone**, open that address in **Safari**. Tap the **Share** button, then **Add to Home Screen**.
7. Open Cardfile from your Home Screen and scan a card. The first scan sets up the card reader, which downloads about 12 MB once. After that it works offline, even with no signal at a conference.

Other free hosts work too, such as Netlify or Cloudflare Pages, if you prefer drag-and-drop. Any host that serves these files over HTTPS is fine.

**Is my data public?** No. The repository only holds the app’s code. Your contacts never leave your phone, and nobody visiting the address can see them; each phone keeps its own separate list.

## Using it

- **Scan:** Tap the camera button and photograph the card so it fills most of the frame, in good light. Cardfile reads it and shows the details to check.
- **Fix mistakes fast:** Under “Text found on the card,” every line Cardfile read is a button. Tap a field, then tap a line to put it there. If the card was read sideways, tap **Rotate and read again**.
- **Two-sided cards:** Tap **Add the back of the card** on the review screen.
- **Where you met:** The last event you entered is filled in for the next card, which saves typing at a conference.
- **Follow-ups:** New contacts get a reminder for 3 days later by default. The Follow-ups tab lists overdue, today, and upcoming reminders.
- **Add to iPhone Contacts:** On any contact, tap **Add to iPhone Contacts**. Use **Export & backup** to add everyone at once or get a CSV spreadsheet for Excel or another CRM.

## Back up your contacts

Because everything is stored only on your phone, deleting the Home Screen app, clearing Safari data, or losing your phone would delete your contacts. Use **Export & backup > Back up everything** regularly and save the file to **iCloud Drive**. It includes contacts, notes, and card photos. **Restore from a backup** adds them back on the same or a new phone. Once you have a few contacts, Cardfile reminds you if you haven’t backed up in two weeks.

Keeping Cardfile on your Home Screen, rather than only in a Safari tab, also stops Safari from clearing its data when the app goes unused for a while.

## Good to know

- Card reading works best on printed cards with clear text. Very stylized fonts, dark backgrounds, or glossy glare can cause misreads, so always glance over the details before saving.
- The reader is set up for English. Cards in other languages may read less accurately, and names in non-Latin scripts need to be typed in.
- To update Cardfile later, upload the new files to the same repository. The app picks up the update the next time it opens with a connection.

## Credits

Text recognition by [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache License 2.0), with the English model from [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) (Apache License 2.0). See `vendor/TESSERACT-LICENSE.md`.
