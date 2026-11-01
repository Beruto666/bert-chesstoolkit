// Lista básica de aberturas (funciona sem internet). A base completa do Lichess é baixada pelo app e tem prioridade.
export const SEED = `A00	Polish Opening	1. b4
A00	Van Geet Opening	1. Nc3
A01	Nimzo-Larsen Attack	1. b3
A02	Bird Opening	1. f4
A04	Réti Opening	1. Nf3
A06	Réti Opening: Nimzo-Larsen Variation	1. Nf3 d5 2. b3
A10	English Opening	1. c4
A20	English Opening: King's English Variation	1. c4 e5
A30	English Opening: Symmetrical Variation	1. c4 c5
A40	Queen's Pawn Game	1. d4
A45	Indian Defense	1. d4 Nf6
A45	Trompowsky Attack	1. d4 Nf6 2. Bg5
A46	Torre Attack	1. d4 Nf6 2. Nf3 e6 3. Bg5
A48	London System	1. d4 Nf6 2. Nf3 g6 3. Bf4
A80	Dutch Defense	1. d4 f5
A84	Dutch Defense: Classical Variation	1. d4 f5 2. c4 Nf6 3. g3 e6
A85	Dutch Defense: Stonewall Variation	1. d4 f5 2. c4 Nf6 3. Nc3 e6 4. Nf3 d5
A90	Dutch Defense: Classical Variation	1. d4 f5 2. c4 e6 3. g3 Nf6 4. Bg2 Be7
B00	King's Pawn Opening	1. e4
B00	Nimzowitsch Defense	1. e4 Nc6
B01	Scandinavian Defense	1. e4 d5
B01	Scandinavian Defense: Main Line	1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5
B02	Alekhine Defense	1. e4 Nf6
B06	Modern Defense	1. e4 g6
B07	Pirc Defense	1. e4 d6 2. d4 Nf6 3. Nc3 g6
B10	Caro-Kann Defense	1. e4 c6
B12	Caro-Kann Defense: Advance Variation	1. e4 c6 2. d4 d5 3. e5
B13	Caro-Kann Defense: Exchange Variation	1. e4 c6 2. d4 d5 3. exd5 cxd5
B15	Caro-Kann Defense: Main Line	1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4
B18	Caro-Kann Defense: Classical Variation	1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5
B20	Sicilian Defense	1. e4 c5
B21	Sicilian Defense: Smith-Morra Gambit	1. e4 c5 2. d4 cxd4 3. c3
B22	Sicilian Defense: Alapin Variation	1. e4 c5 2. c3
B23	Sicilian Defense: Closed	1. e4 c5 2. Nc3
B27	Sicilian Defense: Open	1. e4 c5 2. Nf3
B30	Sicilian Defense: Old Sicilian	1. e4 c5 2. Nf3 Nc6
B32	Sicilian Defense: Open	1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4
B33	Sicilian Defense: Sveshnikov Variation	1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 e5
B40	Sicilian Defense: French Variation	1. e4 c5 2. Nf3 e6
B50	Sicilian Defense	1. e4 c5 2. Nf3 d6
B54	Sicilian Defense: Open	1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4
B56	Sicilian Defense: Classical Variation	1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3
B70	Sicilian Defense: Dragon Variation	1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6
B76	Sicilian Defense: Dragon Variation, Yugoslav Attack	1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6 6. Be3 Bg7
B80	Sicilian Defense: Scheveningen Variation	1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 e6
B90	Sicilian Defense: Najdorf Variation	1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6
B92	Sicilian Defense: Najdorf Variation, Opocensky Variation	1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2
B99	Sicilian Defense: Najdorf Variation, Main Line	1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Bg5 e6 7. f4 Be7
C00	French Defense	1. e4 e6
C01	French Defense: Exchange Variation	1. e4 e6 2. d4 d5 3. exd5 exd5
C02	French Defense: Advance Variation	1. e4 e6 2. d4 d5 3. e5
C03	French Defense: Tarrasch Variation	1. e4 e6 2. d4 d5 3. Nd2
C10	French Defense: Rubinstein Variation	1. e4 e6 2. d4 d5 3. Nc3 dxe4 4. Nxe4
C11	French Defense: Classical Variation	1. e4 e6 2. d4 d5 3. Nc3 Nf6
C15	French Defense: Winawer Variation	1. e4 e6 2. d4 d5 3. Nc3 Bb4
C20	King's Pawn Game	1. e4 e5
C21	Danish Gambit	1. e4 e5 2. d4 exd4 3. c3
C23	Bishop's Opening	1. e4 e5 2. Bc4
C25	Vienna Game	1. e4 e5 2. Nc3
C30	King's Gambit	1. e4 e5 2. f4
C33	King's Gambit Accepted	1. e4 e5 2. f4 exf4
C40	King's Knight Opening	1. e4 e5 2. Nf3
C40	Latvian Gambit	1. e4 e5 2. Nf3 f5
C41	Philidor Defense	1. e4 e5 2. Nf3 d6
C42	Russian Game	1. e4 e5 2. Nf3 Nf6
C42	Russian Game: Classical Attack	1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 4. Nf3 Nxe4 5. d4
C44	Scotch Game	1. e4 e5 2. Nf3 Nc6 3. d4
C45	Scotch Game: Main Line	1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4
C46	Four Knights Game	1. e4 e5 2. Nf3 Nc6 3. Nc3 Nf6
C47	Four Knights Game: Scotch Variation	1. e4 e5 2. Nf3 Nc6 3. Nc3 Nf6 4. d4
C50	Italian Game	1. e4 e5 2. Nf3 Nc6 3. Bc4
C50	Italian Game: Giuoco Piano	1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5
C51	Evans Gambit	1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4
C53	Italian Game: Classical Variation	1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3
C55	Italian Game: Two Knights Defense	1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6
C57	Italian Game: Two Knights Defense, Fried Liver Attack	1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7
C60	Ruy Lopez	1. e4 e5 2. Nf3 Nc6 3. Bb5
C62	Ruy Lopez: Steinitz Defense	1. e4 e5 2. Nf3 Nc6 3. Bb5 d6
C63	Ruy Lopez: Schliemann Defense	1. e4 e5 2. Nf3 Nc6 3. Bb5 f5
C65	Ruy Lopez: Berlin Defense	1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6
C67	Ruy Lopez: Berlin Defense, Rio Gambit Accepted	1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O Nxe4 5. d4 Nd6 6. Bxc6 dxc6 7. dxe5 Nf5
C68	Ruy Lopez: Exchange Variation	1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6
C70	Ruy Lopez: Morphy Defense	1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4
C78	Ruy Lopez: Morphy Defense, Neo-Arkhangelsk Variation	1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O b5 6. Bb3 Bb7
C80	Ruy Lopez: Open	1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Nxe4
C84	Ruy Lopez: Closed	1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7
C88	Ruy Lopez: Closed, Anti-Marshall	1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3
C89	Ruy Lopez: Marshall Attack	1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 O-O 8. c3 d5
D00	Queen's Pawn Game: Mason Variation	1. d4 d5
D00	London System	1. d4 d5 2. Bf4
D01	Rapport-Jobava London System	1. d4 d5 2. Nc3 Nf6 3. Bf4
D02	Queen's Pawn Game: Zukertort Variation	1. d4 d5 2. Nf3
D04	Queen's Pawn Game: Colle System	1. d4 d5 2. Nf3 Nf6 3. e3
D06	Queen's Gambit	1. d4 d5 2. c4
D07	Queen's Gambit Declined: Chigorin Defense	1. d4 d5 2. c4 Nc6
D08	Albin Countergambit	1. d4 d5 2. c4 e5
D10	Slav Defense	1. d4 d5 2. c4 c6
D15	Slav Defense: Three Knights Variation	1. d4 d5 2. c4 c6 3. Nf3 Nf6 4. Nc3
D20	Queen's Gambit Accepted	1. d4 d5 2. c4 dxc4
D30	Queen's Gambit Declined	1. d4 d5 2. c4 e6
D35	Queen's Gambit Declined: Exchange Variation	1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5
D43	Semi-Slav Defense	1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 c6
D45	Semi-Slav Defense: Meran Variation	1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 c6 5. e3 Nbd7
D50	Queen's Gambit Declined: Modern Variation	1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5
D70	Neo-Grünfeld Defense	1. d4 Nf6 2. c4 g6 3. f3 d5
D80	Grünfeld Defense	1. d4 Nf6 2. c4 g6 3. Nc3 d5
D85	Grünfeld Defense: Exchange Variation	1. d4 Nf6 2. c4 g6 3. Nc3 d5 4. cxd5 Nxd5 5. e4
E00	Catalan Opening	1. d4 Nf6 2. c4 e6 3. g3
E10	Blumenfeld Gambit	1. d4 Nf6 2. c4 e6 3. Nf3 c5 4. d5 b5
E11	Bogo-Indian Defense	1. d4 Nf6 2. c4 e6 3. Nf3 Bb4+
E12	Queen's Indian Defense	1. d4 Nf6 2. c4 e6 3. Nf3 b6
E20	Nimzo-Indian Defense	1. d4 Nf6 2. c4 e6 3. Nc3 Bb4
E32	Nimzo-Indian Defense: Classical Variation	1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. Qc2
E41	Nimzo-Indian Defense: Hübner Variation	1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. e3 c5
E60	King's Indian Defense	1. d4 Nf6 2. c4 g6
E70	King's Indian Defense: Normal Variation	1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6
E80	King's Indian Defense: Sämisch Variation	1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. f3
E90	King's Indian Defense: Orthodox Variation	1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2
E97	King's Indian Defense: Orthodox Variation, Bayonet Attack	1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2 e5 7. O-O Nc6 8. d5 Ne7 9. b4
A07	King's Indian Attack	1. Nf3 d5 2. g3
A09	Réti Opening	1. Nf3 d5 2. c4
B07	Pirc Defense: Austrian Attack	1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. f4
B09	Pirc Defense: Austrian Attack	1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. f4 Bg7 5. Nf3
B06	Modern Defense: Standard Line	1. e4 g6 2. d4 Bg7
C24	Bishop's Opening: Berlin Defense	1. e4 e5 2. Bc4 Nf6
C26	Vienna Game: Falkbeer Variation	1. e4 e5 2. Nc3 Nf6
C27	Vienna Game: Frankenstein-Dracula Variation	1. e4 e5 2. Nc3 Nf6 3. Bc4 Nxe4
C29	Vienna Gambit	1. e4 e5 2. Nc3 Nf6 3. f4
D11	Slav Defense: Modern Line	1. d4 d5 2. c4 c6 3. Nf3
D17	Slav Defense: Czech Variation	1. d4 d5 2. c4 c6 3. Nf3 Nf6 4. Nc3 dxc4 5. a4 Bf5
D31	Queen's Gambit Declined: Semi-Slav	1. d4 d5 2. c4 e6 3. Nc3 c6
D37	Queen's Gambit Declined: Harrwitz Attack	1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4
E04	Catalan Opening: Open Defense	1. d4 Nf6 2. c4 e6 3. g3 d5 4. Nf3 dxc4
E15	Queen's Indian Defense: Fianchetto Variation	1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3
E60	King's Indian Defense: Fianchetto Variation	1. d4 Nf6 2. c4 g6 3. g3 Bg7 4. Bg2
`;
