# ♞ Bert ChessToolKit

[English](README.md) · **Português**

App de xadrez gratuito para Linux e Windows, feito com [Tauri 2](https://tauri.app) (AppImage no Linux, instalador no Windows), para estudar sem depender da internet: Biblioteca, Puzzles, Análise com Stockfish, databases enormes de PGN, treino de repertório e de finais, tudo num app leve. Sem anúncios e sem conta obrigatória.

> Projeto pessoal e sem fins comerciais, feito para estudar e compartilhar com amigos.

## Funcionalidades

| | |
| --- | --- |
| 📚 **Biblioteca** | Organize PDFs, EPUBs e PGNs com capa, categorias e status de leitura. PGNs abrem direto na Análise. |
| ♟ **Análise / Novo Tabuleiro** | Variações, comentários, setas, símbolos, edição de PGN, editor de posição, Stockfish (gerenciado pelo app ou qualquer engine UCI), barra de avaliação e gráfico da partida, precisão em %, classificação dos lances, jogar contra a engine com tutor, nome da abertura (ECO). |
| 🧩 **Puzzles** | Treine com o seu PGN ou baixe o banco de puzzles do Lichess e filtre por tema, rating e abertura. Revisão espaçada e modo relâmpago. |
| 🌳 **Repertório** | Importe ou monte repertórios; modos Estudar, Treinar e Revisão com repetição espaçada. |
| 🗄 **Databases** | Importe PGNs de dezenas de GB (leitura em streaming, só um índice é gravado). Busca por jogador, resultado, ano ou **posição/padrão**; explorador de aberturas; relatório de jogador; ferramentas de limpeza; baixe partidas do Lichess ou do Chess.com. |
| 🌐 **Explorador online** | Mestres do Lichess, jogadores do Lichess (filtros de ritmo e rating) e jogador específico, dentro da Análise (precisa de um token grátis do Lichess, veja abaixo). |
| 🎯 **Treinos** | Finais contra a engine (R+D, torre, dois bispos, Lucena…), treino de coordenadas e *Adivinhe o lance*. |
| ⚙ **Configurações** | Temas do app (claro, escuro, preto, azulado…), peças, cores e tamanho do tabuleiro, sons, interface em **português ou inglês**. |

Lista detalhada e histórico de versões: [docs/FEATURES.pt-BR.md](docs/FEATURES.pt-BR.md).

## Baixar / compilar

Os downloads prontos ficam na página de [Releases](../../releases): um **AppImage** para Linux e um instalador **`-setup.exe`** para Windows 10/11.

> **Aviso no Windows:** o instalador não é assinado digitalmente, então o SmartScreen pode dizer "O Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**. (Se o navegador bloquear o download, abra a lista de downloads e escolha **Manter**.) O app é de código aberto; você pode compilar você mesmo, como abaixo.

Para compilar (exemplo para Arch / CachyOS):

```sh
sudo pacman -S --needed rust nodejs npm webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg xdotool xdg-utils
npm install
npm run tauri dev        # testar
NO_STRIP=true APPIMAGE_EXTRACT_AND_RUN=1 npm run tauri build -- --bundles appimage
```

O AppImage sai em `src-tauri/target/release/bundle/appimage/`.

### Windows
O instalador é gerado pelo workflow `Release (Windows)` do GitHub Actions, ou localmente com `npm run tauri build -- --bundles nsis` (precisa de Rust, Node e WebView2, que já vem no Windows 10/11). É mais novo que a versão Linux e foi menos testado: avise se encontrar problemas. No Windows o app usa o `curl.exe` e o `tar.exe` que já vêm no sistema, toca os sons .wav nativamente e não precisa do `zstd`.

### Requisitos em tempo de execução
- `curl` (downloads do Stockfish, partidas do Lichess/Chess.com, puzzles e nomes de aberturas).
- `zstd` (só para o banco de puzzles do Lichess).
- `pw-play`, `paplay` ou `aplay` para os sons.

## Token do explorador online

O Lichess exige um token pessoal para o explorador de aberturas. Crie um grátis em <https://lichess.org/account/oauth/token> (**sem marcar nenhuma permissão**) e cole em *Configurações → Token do Lichess…*. Ele fica só no seu computador e só é enviado ao Lichess.

## Idioma

Português (padrão) e inglês, em *Configurações → Idioma*. As traduções ficam em `src/i18n_en.js`, em pares `["texto em português", "English text"]`; para melhorar ou completar uma tradução basta editar esse arquivo.

## Licença

Código do app: [MIT](LICENSE). Regras de xadrez: [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause). Os conjuntos de peças mantêm as próprias licenças, alguns **não comerciais** (CC BY-NC-SA) ou GPL; veja [src/pieces/CREDITS.md](src/pieces/CREDITS.md). Nomes de aberturas: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0); puzzles: banco do Lichess (CC0). O Stockfish é baixado à parte (GPLv3). Os sons dos lances vêm do repositório do [Lichess](https://github.com/lichess-org/lila) (`public/sound`); confira a licença antes de redistribuir. O set de peças "Capivara" é o Cburnett com um cavalo baseado no [ícone Capybara de Rafaela QB](https://thenounproject.com/icon/capybara-470903/), do The Noun Project (crédito obrigatório).

Sem vínculo com o Lichess, o Chess.com ou o Stockfish.

## Créditos
Ideias, design e direção de [Beruto666](https://github.com/Beruto666). Feito com a ajuda do [Claude](https://claude.ai) (Anthropic).
