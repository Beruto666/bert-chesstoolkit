# Bert ChessToolKit — funcionalidades em detalhe (português)

Três ferramentas de xadrez num app só para Linux (Tauri 2, AppImage):

- **📚 Biblioteca**: organize PDFs, EPUBs e PGNs com capa, título, autor, categorias e status de leitura (filtros: tipo, categoria e status). PDF e EPUB abrem no programa que você escolher (ex.: Firefox); **PGN abre direto na Análise**, dentro do app. Arquivos ficam em `~/Biblioteca Bertonática`.
- **🧩 Puzzles**: treine com o **seu PGN** (cada partida com `[FEN]` é um puzzle, linha principal = solução). Feedback certo/errado, comentários `{...}` como explicação, dica, solução, estatísticas, aparência (peças e tabuleiro).
  - **Puzzles do Lichess**: botão *Puzzles do Lichess* → *Baixar o banco* (≈250 MB, uma vez; usa `curl`) e depois escolha temas (60, em português), faixa de rating, quantidade, abertura, sorteio e ordem de dificuldade; o app cria um conjunto normal (com revisão espaçada e relâmpago). Os temas aparecem depois de resolver. Precisa do programa `zstd` (no Arch/CachyOS já vem instalado).
  - **🔁 Revisão espaçada**: errou, volta amanhã; acertou, volta em 3, 7, 14 e 30 dias.
  - **⚡ Relâmpago**: 1, 3 ou 5 minutos; acerto = +1 ponto, erro = −10 s; guarda seu recorde.
  - **Tabuleiro redimensionável**: ajuste automático à janela (padrão), slider em 🎨 Aparência ou arraste a alça no canto do tabuleiro (duplo clique volta ao automático).
- **♟ Análise / Novo Tabuleiro**: tabuleiro próprio, sem programa externo.
  - Jogue lances arrastando ou clicando; **variações** automáticas ao jogar um lance diferente.
  - **Anotações**: comentários, símbolos (! ? !! ?? !? ?! = ± ∓ +− −+ ∞), setas e círculos (botão direito; Shift = vermelho, Ctrl = azul, Alt = amarelo), limpar setas. Tudo é salvo no PGN (`[%cal]`, `[%csl]`).
  - **Editar PGN**: promover variação, linha principal, excluir daqui, desfazer/refazer (Ctrl+Z), cabeçalhos, colar/copiar/exportar PGN.
  - **Partidas do arquivo**: abra um PGN com várias partidas e navegue pela lista; Salvar regrava só a partida editada.
  - Atalhos: ← → navegam, ↑/↓ início/fim, F vira o tabuleiro, Del exclui, Ctrl+S salva, roda do mouse sobre o tabuleiro navega.
  - **Stockfish (etapa 3)**: baixado e gerenciado pelo próprio app (⚙ ao lado do interruptor da engine) ou usando o `stockfish` do sistema / um programa UCI à sua escolha.
    - **Barra de avaliação** ao lado do tabuleiro (estilo Lichess) e **linhas da engine** (1 a 5 variantes); clique em qualquer lance de uma linha para jogá-la no tabuleiro.
    - **Gráfico da partida** sob o tabuleiro: **Analisar partida** avalia a linha principal e desenha a curva; clique ou arraste para navegar. Pontos coloridos marcam imprecisões, erros e erros graves, com resumo e perda média por lado.
    - A engine só roda enquanto você está na Análise; avaliações ficam em cache.
    - **Precisão em %** por lado depois de *Analisar partida* (método do Lichess: nota por lance pela perda de chance de vitória, média ponderada + harmônica).
  - **Editor de posição** (botão *Editor de posição* na aba Info): paleta de peças (clique e pinte, ou arraste), mover/apagar (arrastar para fora apaga; botão direito apaga), posição inicial, limpar, inverter, trocar cores, vez, roques, en passant e campo FEN; valida reis, peões e xeque ilegal antes de usar.
  - **Animação das peças** ao jogar/navegar (Análise e Puzzles), desligável em *Aparência*. Arrastar a peça não anima.
  - Um rascunho é guardado automaticamente; se o app fechar, ele volta em **Novo Tabuleiro**.
  - **Jogar contra o Stockfish** (botão ⚔ na barra do tabuleiro): força ajustável (Elo 1320 a 3190, ou força máxima), tempo por lance, suas peças (brancas, pretas ou aleatório), da posição atual ou de uma partida nova. Os lances entram na árvore da Análise (dá para salvar o PGN e analisar depois); a análise e a barra de avaliação ficam pausadas durante a partida. *Voltar lance*, *Desistir* e *Encerrar* na barra abaixo do tabuleiro.
  - **Classificação dos lances**: depois de *Analisar partida* (ou ao abrir um PGN com `[%eval]`), a lista de lances ganha uma bolinha colorida nos lances que perderam chance de vitória: azul = imprecisão (≥5%), laranja = erro (≥10%), vermelha = erro grave (≥15%). Passe o mouse para ver a perda. Lances que você já marcou com ?, ?? ou ?! mantêm a sua marca.
  - **Menu de botão direito nos lances** (lista de lances): promover variação, tornar linha principal, excluir (a variação ou "daqui em diante"), marcar com ! ? !! ?? !? ?!, comentar, copiar os lances até ali ou o FEN.
  - **Sons dos lances** (mover, capturar, xeque, roque, fim de partida; certo/errado nos puzzles), sintetizados pelo app. Desligue em *Aparência*.
  - **Motor próprio**: em ⚙ (ao lado do interruptor da engine) → *Escolher outro programa…* aceita qualquer engine UCI (Komodo, Lc0, Berserk…). O app testa o programa e diz se ele tem limite de força (UCI_Elo), que a partida contra o motor usa.
  - **Nome da abertura** (código ECO + nome) acima da lista de lances, atualizado a cada lance, com suporte a transposições. Usa a base do Lichess (≈3.500 aberturas, CC0), baixada uma vez na primeira abertura da Análise com internet; sem internet vale uma lista básica embutida.

- **🗄 Databases (etapa 4, início)**: importe PGNs enormes (testado em geração de índice a ~300 MB/s). O app lê o arquivo em streaming e grava só um índice em `~/Biblioteca Bertonática/.databases/`; **o PGN original precisa continuar no mesmo lugar** (não é copiado nem apagado). Busca por jogador, resultado e ano, lista paginada; clicar numa partida abre na Análise. 
  - **Explorador na Análise** (aba *Database*): escolha a database no seletor (fica salva); a cada lance aparecem os lances mais jogados com % de vitórias/empates/derrotas, Elo médio e as melhores partidas daquela linha. Clique num lance para jogá-lo, ou numa partida para abri-la. Compara **posições**, então transposições somam (ex.: 1.e4 e5 2.Nf3 e 1.Nf3 e5 2.e4 caem na mesma posição); vale para os 30 primeiros plies e só para partidas que começam da posição inicial. A database guarda um hash da posição após cada um dos 30 primeiros lances (`pos.bin`, ≈120 bytes por partida). Databases importadas antes da v1.10 continuam funcionando pelo método antigo (sequência de lances); remova e importe de novo para ganhar o modo por posição.
  - **Filtro de jogador e cor no explorador**: abaixo do seletor de database, digite um jogador (aceita parte do nome, com sugestões) e escolha **Ambos** (padrão), **Brancas** ou **Pretas**. Os lances, percentuais e melhores partidas passam a mostrar só as partidas dele naquela cor. O jogador e a cor ficam salvos; o × limpa o filtro.
  - **Nuvem do Lichess** (Análise): interruptor "Nuvem do Lichess" abaixo das linhas da engine mostra a avaliação e as 2 melhores linhas de posições já analisadas pelo Lichess, sem gastar CPU (precisa de internet; o Lichess limita a ~1 consulta por segundo). Posições bem analisadas também alimentam a barra e o gráfico com a engine desligada.
  - **Avaliações no PGN**: partidas que já trazem `[%eval]` (Lichess, En Croissant) preenchem o gráfico e a precisão sem rodar a engine. Depois de **Analisar partida**, o botão **Anotar** grava `[%eval]` em cada lance e marca `?!`, `?` e `??` nos lances sem marca sua (ou só as avaliações, ou remove as avaliações). Dá para desfazer.
  - **Explorador do ponto de vista do jogador**: com jogador e cor escolhidos, as barras mostram verde = vitória dele e vermelho = derrota.
  - **Busca por jogador** com filtro de lado (só de brancas / só de pretas), resultado e ano. Botões de manutenção por database: **Jogadores / mesclar** (junta variações do nome numa só), **Remover partidas vazias** e **Remover duplicadas** (mesmos jogadores, data, resultado e primeiros 30 lances). Só o índice muda; o PGN original não é alterado.
  - **Partidas online como database**: em *Databases*, digite um usuário do Lichess ou do Chess.com; o app baixa as partidas (usa `curl`; se ele não estiver instalado, o app avisa ao abrir) e indexa. Databases criadas na v1.3.2 precisam ser removidas e importadas de novo para ter o explorador.

- **🌳 Repertório**: importe um PGN com variantes (cada partida do arquivo = um capítulo) ou use o botão **Treinar** na aba Info da Análise, e escolha sua cor. Três modos:
  - **Estudar**: o app mostra o lance (seta) e os comentários do PGN; você joga a linha.
  - **Treinar**: você joga de memória uma linha inteira (o adversário responde pelo PGN); errou duas vezes, o app mostra o lance. Cada posição ganha nota.
  - **Revisão**: só as posições vencidas, com repetição espaçada por posição (acertou: volta em 1, 3, 7, 14, 30, 60 dias; errou: volta hoje). Transposições são tratadas como a mesma posição e qualquer lance do repertório naquela posição é aceito.
  - **Construir do zero**: **+ Novo repertório** pergunta nome e cor e abre a Análise vazia, já orientada para o seu lado. Jogue os lances (os seus e as respostas do adversário), faça variantes, comente e desenhe setas; **Salvar** grava no repertório e **Treinar repertório** volta para o treino. Cada partida do arquivo é um capítulo (botão *Nova* na Análise). **Editar / construir** reabre um repertório existente.
  - Os dados ficam no app (IndexedDB, store `reps`).

## Compilar (CachyOS / Arch)
```sh
sudo pacman -S --needed rust nodejs npm webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg xdotool xdg-utils
npm install
npm run tauri dev        # testar
NO_STRIP=true APPIMAGE_EXTRACT_AND_RUN=1 npm run tauri build -- --bundles appimage
```
O AppImage sai em `src-tauri/target/release/bundle/appimage/`.

## Dados
Livros: `~/Biblioteca Bertonática`. Puzzles e preferências: dentro do app (identificador `com.bert.puzzles`).

## Ícones
Os ícones da interface são SVGs simples de traço (sprite no `index.html`). O ícone do app é o cavalo da tela inicial; para regerar, veja `src-tauri/icons/`.

## Licenças
Código do app: MIT. Regras de xadrez: [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause, em `src/vendor/`). Peças em `src/pieces/` com licenças próprias (ver `src/pieces/CREDITS.md`; Staunty e outras são CC BY-NC-SA, uso não comercial). O cavalo do ícone e da tela inicial é o conjunto Cburnett (GPLv2+).

## Novidades da v1.24.0
- Biblioteca: PDFs e EPUBs ganham como capa, automaticamente, a primeira imagem do livro (EPUB: a capa; PDF: a primeira imagem grande). Livros sem imagem e PGNs continuam com a capa colorida de sempre. No editor há "Usar imagem do livro", "Escolher imagem" e "Remover capa" (que mantém a capa colorida e não é refeita).

## Novidades da v1.23.0 (Windows, experimental)
- Primeira versão preparada para Windows (instalador gerado pelo GitHub Actions). **Ainda não foi testada em um Windows de verdade**, então pode ter ajustes. No Linux nada mudou.
- No Windows: usa o curl e o tar que já vêm no Windows 10/11, toca os sons .wav pelo próprio sistema, descompacta o banco de puzzles dentro do app (sem instalar o zstd) e o seletor de arquivos mostra os discos (C:, D:…).

## Novidades da v1.22.1 (otimização)
- Peças da capivara em WebP (284 KB → 85 KB); sons do Lichess numa só cópia e em 32 kHz (160 KB → 55 KB).
- Binário menor: perfil de release com LTO, `codegen-units = 1` e `panic = "abort"`; removido o plugin de diálogo nativo (o app usa o seletor próprio), junto com suas dependências.
- O dicionário de inglês (51 KB) só é carregado quando o idioma é inglês.

## Novidades da v1.22.0
- **Sons do Lichess** como padrão (lance, captura, roque, xeque e fim de partida), recortados para tocar sem atraso; acerto/erro dos puzzles continuam sintetizados.
- **Peças "Capivara"** (Cburnett com cavalo-capivara), em Configurações → Peças.
- **Importar** PGN direto na Análise / Novo Tabuleiro.
- **Biblioteca**: selecionar vários itens e **Excluir** de uma vez.
- **Treino de finais**: botão "+ Adicionar posição" (nome, descrição e FEN), "×" para remover e "Restaurar padrões".
- **Coordenadas**: botão Ampliar/Reduzir o tabuleiro.
- **Databases**: o botão Abrir vira Fechar; a busca por jogador é compartilhada e há abas **Partidas / Posição / Torneios**. A busca por **torneio ou local** lê o cabeçalho de cada partida (Event/Site) do PGN original.
- **Análise**: selo no tabuleiro com a classificação do lance (?!, ?, ??) a partir das avaliações da engine, como no Lichess.
- Tela inicial: "Uma interface de xadrez simples" / "A simple chess GUI". Sem a piscada de cor antiga ao abrir o app.

## Novidades da v1.21.0
- **Sons novos e mais suaves** (madeira macia para os lances, sinos para xeque/fim, marimba para acerto). Os antigos usavam ondas de serra/triângulo, que cansavam. Os .wav padrão em `.sons` são regravados uma vez; arquivos de outros formatos (.ogg, .flac, .mp3) que você tenha colocado lá continuam valendo.

## Novidades da v1.20.0 (versão final)
- Tema **preto** como padrão (quem já escolheu outro tema mantém o seu).
- A etiqueta "Lendo" (e "Concluído") na Biblioteca ficou legível nos temas escuros.
- Limpeza de código: exports sem uso removidos.

## Novidades da v1.19.0
- **Engrenagem de Configurações** (canto superior direito de todas as telas): idioma, tema do app, tamanho do tabuleiro, peças, cores, coordenadas, animação, sons e token do Lichess. O antigo botão *Aparência* foi removido das telas.
- **Idioma**: português (padrão) ou inglês; a troca recarrega o app.

## Novidades da v1.18.0 (versão final)
- **Explorador online do Lichess** na aba Database da Análise: "Mestres (Lichess)", "Jogadores do Lichess" (filtros de ritmo e rating) e "Jogador no Lichess" (escolha o usuário e a cor). Mostra lances, resultados e partidas; clicar numa partida abre ela numa nova aba.
- O Lichess passou a exigir um **token pessoal** para o explorador: crie um grátis em lichess.org/account/oauth/token (sem marcar permissões) e cole no botão "Token". Ele fica só no seu computador e é enviado apenas ao Lichess.

## Novidades da v1.17.0
- **Seletor de arquivos dentro do app**: importar/abrir/exportar agora abre uma janela do próprio app (sempre na frente, na última pasta usada, com atalhos Início/Downloads/Biblioteca/pendrives, busca, filtro por tipo e seleção múltipla), em vez do diálogo nativo que no Wayland/tiling abria como outra janela fora de foco.
- **Tela inicial reordenada**: Biblioteca, Novo Tabuleiro, Puzzles, Repertório, Databases e Treinos.
- **Temas do app** (🎨 Aparência → *Tema do app*): Automático (segue o sistema), Claro, Escuro marrom, **Preto** (fundo preto e ícones brancos) e **Azul noturno**. A escolha fica salva.

## Novidades da v1.16.0
- **Relatório do jogador** (Databases → abrir uma database → digite o nome no filtro *Jogador* → **Relatório do jogador**): partidas, % de pontos, Elo pico/recente/oponente médio, resultados com brancas e com pretas, gráfico do Elo por ano, aberturas mais jogadas por cor (com o nome ECO) e as melhores vitórias (clique abre a partida). Usa só o índice, então é rápido mesmo em bases enormes. Se o nome casar com várias grafias, aparecem como botões: clique em uma para refazer só com ela. Databases importadas em versão antiga mostram tudo menos as aberturas (reimporte para tê-las).

## Novidades da v1.15.0
- **Adivinhe o lance** (Treinos → Adivinhe o lance): sorteia uma partida da sua database (filtro de Elo médio), mostra a abertura e você adivinha os lances de um lado. 1 ponto de primeira, ½ na segunda tentativa ou com dica; os nomes só aparecem no fim e dá para abrir a partida na Análise. Guarda seu aproveitamento.
- **Tablebase do Lichess** (botão *Tablebase* ao jogar/treinar finais, precisa de internet): para posições com até 7 peças mostra o resultado teórico, o mate em N lances e o melhor lance.
- **Mais finais** no treino: duas torres contra rei (escada) e rei à frente do peão na 6ª fileira.

## Novidades da v1.14.0
- **Sons dos lances pelo sistema**: o app toca os sons via `pw-play`/`paplay`/`aplay` (o WebAudio do WebKitGTK costuma ficar mudo no Linux); se não houver player, cai no WebAudio. Em **🎨 Aparência → Pasta dos sons…** ficam `move`, `capture`, `castle`, `check`, `end`, `ok`, `bad` (.wav); para usar outros sons (ex.: os do Lichess), troque os arquivos por `.wav`/`.ogg`/`.flac` com o mesmo nome.
- **Sem seleção azul**: texto e imagens não são mais selecionados/arrastados por acidente (só nos campos de texto).
- **Seletores novos**: menu no tema do app (e janela de escolha com busca para repertórios, capítulos, conjuntos de puzzles e databases), em vez da lista nativa que cobria o tabuleiro.
- Limpeza: removidos código sem uso (`fen3`, arquivo `pos.rs` órfão).

## Novidades da v1.13.0
- **Abas na Análise**: abra várias partidas ao mesmo tempo (botão **+**, ×, clique do meio fecha). As abas e o que foi editado sobrevivem a fechar o app. Abrir um arquivo/partida/repertório usa uma aba nova (ou a atual, se estiver vazia).
- **Tutor** (em *Jogar contra o motor* → “Tutor”): depois do seu lance o app compara a posição antes/depois com o motor na força máxima; se você perder ≥ 12% de chance, avisa o melhor lance e deixa **Desfazer** ou **Seguir assim** (o motor espera).
- **🏋 Treinos** (tela inicial): **Finais** clássicos contra o Stockfish na força máxima (dama, torre, dois bispos, bispo+cavalo, Lucena) com contagem de vitórias; **Coordenadas**: 30 s clicando na casa pedida (brancas/pretas), com recorde.
- **Busca por posição/padrão nas databases** (Databases → abrir uma database → *Buscar por posição ou padrão*): monte a posição no editor (sem exigir os dois reis) e escolha *Contém estas peças nas mesmas casas* (padrão, ex.: “torre em g7 + peão em h6”) ou *Posição exata*. O app reproduz todas as partidas do PGN original e mostra, em tempo real, as que passam por ela; clique para abrir a partida já no lance encontrado. Respeita o filtro de jogador. Em bases de dezenas de GB leva alguns minutos; dá para cancelar. Partidas com `[FEN]` (não começam da posição inicial) são ignoradas.

## Status de leitura (Biblioteca)
Cada item pode ser *Não lido*, *Lendo* ou *Concluído*, com uma nota curta (ex.: "parei no capítulo 5"). Abrir um item novo o marca como *Lendo*. Há filtro por status e mudança em lote pelo modo **Selecionar**.

## Perfis de jogador (várias contas)
Em **Databases → Perfis de jogadores**, crie um perfil (ex.: “Joãozinho”) e junte as contas da mesma pessoa (Lichess + Chess.com, quantas quiser). *Estatísticas* mostra as partidas e % de vitórias/empates/derrotas somadas e os ratings de cada conta. *Baixar partidas* traz todas as contas para **uma única database**, com os nomes das contas unificados no nome do perfil; no explorador da Análise, digitar o nome do perfil e escolher a cor mostra só as partidas dele nas duas contas. *Atualizar partidas* baixa tudo de novo e substitui a database do perfil.

## Perfil online
Na tela **Databases**, escolha Lichess ou Chess.com, digite o usuário e clique em **Ver perfil**: ratings por modo, total de partidas, % de vitórias, empates e derrotas, e datas da conta. De lá dá para **Baixar partidas dele** direto para uma database.
