# TorBox Bulk Magnet Sender

Userscript for Violentmonkey / Tampermonkey that scans any page for `magnet:` links, lets you review or deselect items in a floating checklist, and sends them in parallel to your [TorBox](https://torbox.app) account.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open the raw script URL to install:
   `https://raw.githubusercontent.com/pierrer22/torbox-bulk-add/main/torbox-bulk-add.user.js`

## Usage

1. Copy your TorBox API key from [torbox.app/settings](https://torbox.app/settings).
2. Open any page containing `magnet:` links — a floating widget appears in the bottom-right corner with all unique torrents selected by default.
3. Click **API Key** (or use the userscript menu command **Set TorBox API Key**) to save your key once.
4. Uncheck any torrents you don't want (or use **Deselect all** / **Select all**).
5. Click **Send X/N to TorBox** to start sending immediately.

## Features

- **BTIH Deduplication:** Deduplicates magnet links by infohash (`urn:btih:...`) so duplicate links with different trackers aren't sent twice.
- **Selectable Checklist:** Scrollable, collapsible list (`Hide` / `List`) with all items checked by default.
- **Parallel Sending:** Sends up to `5` concurrent requests (`CONCURRENCY = 5`) to `POST https://api.torbox.app/v1/api/torrents/createtorrent`.
- **Rate-Limit & Auth Handling:** Automatically retries once after `1500ms` on HTTP `429`, and stops early on `401`/`403` auth errors.
