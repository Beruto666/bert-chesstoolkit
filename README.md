# ♞ Bert ChessToolKit

**English** · [Português](README.pt-BR.md)

A free, offline-first chess study app for Linux, built with [Tauri 2](https://tauri.app) (AppImage). Library, puzzles, analysis with Stockfish, huge PGN databases, opening repertoire training and endgame drills in a single lightweight app. No ads, no account required.

> Personal, non-commercial project. Made for studying and sharing with friends.

## Features

| | |
| --- | --- |
| 📚 **Library** | Organize PDFs, EPUBs and PGNs with covers, categories and reading status. PGNs open straight in the analysis board. |
| ♟ **Analysis / New board** | Variations, comments, arrows, symbols, PGN editing, position editor, Stockfish (managed by the app or any UCI engine), eval bar and game graph, accuracy %, move classification, play against the engine with a tutor, opening names (ECO). |
| 🧩 **Puzzles** | Train with your own PGN, or download the Lichess puzzle database and filter by theme / rating / opening. Spaced repetition and Puzzle Storm-like timed mode. |
| 🌳 **Repertoire** | Import or build opening repertoires; Study, Train and spaced-repetition Review modes. |
| 🗄 **Databases** | Import PGN files of tens of GB (streamed, only an index is stored). Search by player, result, year or **position/pattern**; opening explorer; player report; merge/clean tools; download games from Lichess or Chess.com. |
| 🌐 **Online explorer** | Lichess Masters, Lichess players (speed/rating filters) and single-player explorers right inside the analysis board (needs a free Lichess token, see below). |
| 🎯 **Training** | Endgame drills against the engine (K+Q, K+R, two bishops, Lucena…), board coordinates trainer and *Guess the move*. |
| ⚙ **Settings** | App themes (light, dark, black, blue…), piece sets (including a capybara set), board colors and size, move sounds, **Portuguese / English** interface. |

A detailed (Portuguese) feature list and changelog is in [docs/FEATURES.pt-BR.md](docs/FEATURES.pt-BR.md).

## Download / build

Pre-built AppImages, when available, are on the [Releases](../../releases) page.

To build it yourself (Arch / CachyOS shown; on Debian/Ubuntu install the equivalent `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `patchelf`, `libxdo-dev`):

```sh
sudo pacman -S --needed rust nodejs npm webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg xdotool xdg-utils
npm install
npm run tauri dev        # run in development
NO_STRIP=true APPIMAGE_EXTRACT_AND_RUN=1 npm run tauri build -- --bundles appimage
```

The AppImage is created in `src-tauri/target/release/bundle/appimage/`.

### Runtime requirements
- `curl` (downloads of Stockfish, Lichess/Chess.com games, puzzles and opening names).
- `zstd` (only for the Lichess puzzle database).
- One of `pw-play`, `paplay` or `aplay` for move sounds.

## Online explorer token

Lichess requires a personal token for its opening explorer. Create one for free at <https://lichess.org/account/oauth/token> (**do not tick any scope**), then paste it in *Settings → Lichess token…* (or the *Token* button of the explorer). It is stored only on your computer and sent only to Lichess.

## Language

Portuguese (default) and English. Switch in *Settings → Language*. English strings live in `src/i18n_en.js` as `["texto em português", "English text"]` pairs; to improve a translation or add a missing one just edit that file.

## Project layout

```
src/            front-end (vanilla JS modules, no bundler)
src/vendor/     chess.js
src/pieces/     piece sets (see CREDITS.md for licenses)
src-tauri/      Rust back-end (PGN database indexer, engine, downloads, sounds…)
docs/           extra documentation
```

## Platform support

Linux only for now. A Windows port is possible (Tauri supports it) but needs work on audio, file browsing and engine download.

## License

App code: [MIT](LICENSE). Rules of chess: [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause). The bundled piece sets keep their own licenses, some of them **non-commercial** (CC BY-NC-SA) or GPL — see [src/pieces/CREDITS.md](src/pieces/CREDITS.md). Opening names come from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0); puzzles from the Lichess database (CC0). Stockfish is downloaded separately (GPLv3). Move sounds come from the [Lichess](https://github.com/lichess-org/lila) repository (`public/sound`) — check their license before redistributing. The "Capybara" piece set is Cburnett with a knight based on the [Capybara icon by Rafaela QB](https://thenounproject.com/icon/capybara-470903/) from The Noun Project (credit required).

Not affiliated with Lichess, Chess.com or Stockfish.
