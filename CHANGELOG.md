# Journal de NestorCut

Une entrée par version mise en production. En langage d'atelier — jamais de
noms de lots internes. La version affichée dans l'en-tête est le
`MAJEUR.MINEUR` ; ici et dans le pied de page, le numéro complet.

## V0.9.17

*FR*

- Nouveau : tôle importée d'un DXF. Dans un projet « Cet appareil », le bouton « Importer une tôle (DXF) » lit le contour d'une tôle de forme quelconque : disque, chute, plaque à encoches. L'imbrication reste à l'intérieur du vrai contour. Cercles, arcs, ellipses, courbes et polylignes à arcs sont lus.
- Zones interdites : dans la fenêtre d'import, chaque contour intérieur du dessin se clique pour devenir une zone interdite (trou déjà découpé, défaut, emplacement d'une bride). Aucune pièce n'y est posée. Rien n'est interdit tant que vous ne l'avez pas choisi, et les zones se modifient ensuite depuis la ligne de la tôle.
- Reprendre une chute : le fichier de coupe d'une tôle importée s'importe à son tour comme tôle. Les pièces déjà découpées y apparaissent comme contours intérieurs et s'interdisent en un clic ; le calcul suivant ne pose rien dessus.
- Résultat d'une tôle importée : l'aperçu, la vignette de la liste des résultats et la vue pendant le calcul dessinent le vrai contour, avec les zones interdites en rouge. La densité est mesurée sur la surface réelle de la tôle. Un contrôle « Zones interdites libres » s'ajoute aux contrôles existants, et la chute rectangulaire n'est plus annoncée pour ces tôles.
- Fichier de coupe d'une tôle importée : le vrai contour est sur le calque BIN_BOUNDARY et les zones interdites sur le calque FORBIDDEN_ZONE, à exclure de la découpe dans votre logiciel de pilotage. Le zéro reste le coin bas-gauche du rectangle qui entoure la tôle. Le cadre autour des pièces (calque OUT_SHAPE) n'est pas tracé sur ces tôles.
- La forme de la tôle reste dans votre navigateur, comme vos pièces : elle n'est pas envoyée.
- Offre Free : vous importez la tôle, marquez les zones, imbriquez, et voyez l'aperçu, les contrôles et la densité. Les fichiers de coupe de ces calculs (DXF, ZIP, .job SheetCam) et la vue DXF demandent l'offre Unlimited ; reprendre une chute passe par le fichier de coupe téléchargé, donc par Unlimited.
- Calcul avec deux formats de tôle : pendant le calcul, les pièces de la plus grande tôle ne sont plus rognées à l'écran, et l'image finale dessine chaque tôle à sa taille.
- Option « Tracer le contour de la tôle » : son texte d'aide dit maintenant ce qu'elle fait : ajouter un cadre autour des pièces posées (calque OUT_SHAPE). Le contour de la tôle est toujours dans le fichier.

*EN*

- New: sheet imported from a DXF. In a "This device" project, the "Import a sheet (DXF)" button reads the outline of a sheet of any shape: disc, offcut, plate with notches. The nesting stays inside the true outline. Circles, arcs, ellipses, curves and polylines with arcs are read.
- Forbidden zones: in the import window, each inner outline of the drawing can be clicked to become a forbidden zone (hole already cut, defect, clamp position). No part is placed on it. Nothing is forbidden until you choose it, and the zones can be edited afterwards from the sheet's row.
- Reusing an offcut: the cutting file of an imported sheet can itself be imported as a sheet. The parts already cut appear there as inner outlines and are forbidden with one click; the next nesting places nothing on them.
- Result on an imported sheet: the preview, the thumbnail in the results list and the view during the nesting draw the true outline, with the forbidden zones in red. The density is measured on the real surface of the sheet. A "Forbidden zones clear" check is added to the existing checks, and the rectangular offcut is no longer shown for these sheets.
- Cutting file of an imported sheet: the true outline is on the BIN_BOUNDARY layer and the forbidden zones on the FORBIDDEN_ZONE layer, to be excluded from cutting in your machine software. The zero stays at the bottom-left corner of the rectangle around the sheet. The frame around the parts (OUT_SHAPE layer) is not drawn on these sheets.
- The shape of the sheet stays in your browser, like your parts: it is not sent.
- Free plan: you import the sheet, mark the zones, nest, and see the preview, the checks and the density. The cutting files of these nestings (DXF, ZIP, SheetCam .job) and the DXF view require the Unlimited plan; reusing an offcut goes through the downloaded cutting file, so it needs Unlimited.
- Nesting with two sheet formats: during the nesting, the parts of the larger sheet are no longer cropped on screen, and the final image draws each sheet at its own size.
- "Draw sheet outline on export" option: its help text now says what it does: it adds a frame around the placed parts (OUT_SHAPE layer). The sheet outline is always in the file.

*PT*

- Novo: chapa importada de um DXF. Num projeto «Este dispositivo», o botão «Importar uma chapa (DXF)» lê o contorno de uma chapa de qualquer forma: disco, retalho, placa com entalhes. O aninhamento fica dentro do contorno real. Círculos, arcos, elipses, curvas e polilinhas com arcos são lidos.
- Zonas proibidas: na janela de importação, cada contorno interior do desenho pode ser clicado para virar uma zona proibida (furo já cortado, defeito, posição de uma garra). Nenhuma peça é colocada nela. Nada é proibido enquanto você não escolher, e as zonas podem ser editadas depois a partir da linha da chapa.
- Reaproveitar um retalho: o arquivo de corte de uma chapa importada pode ser importado, por sua vez, como chapa. As peças já cortadas aparecem nele como contornos interiores e se proíbem com um clique; o cálculo seguinte não coloca nada sobre elas.
- Resultado de uma chapa importada: a pré-visualização, a miniatura na lista de resultados e a vista durante o cálculo desenham o contorno real, com as zonas proibidas em vermelho. A densidade é medida sobre a superfície real da chapa. Uma verificação «Zonas proibidas livres» se soma às verificações existentes, e o retalho retangular deixa de ser anunciado para essas chapas.
- Arquivo de corte de uma chapa importada: o contorno real fica na camada BIN_BOUNDARY e as zonas proibidas na camada FORBIDDEN_ZONE, a excluir do corte no seu software de comando. O zero continua no canto inferior esquerdo do retângulo que envolve a chapa. A moldura em volta das peças (camada OUT_SHAPE) não é desenhada nessas chapas.
- A forma da chapa fica no seu navegador, como as suas peças: não é enviada.
- Plano Free: você importa a chapa, marca as zonas, faz o aninhamento e vê a pré-visualização, as verificações e a densidade. Os arquivos de corte desses cálculos (DXF, ZIP, .job SheetCam) e a vista DXF exigem o plano Unlimited; reaproveitar um retalho passa pelo arquivo de corte baixado, portanto exige o Unlimited.
- Cálculo com dois formatos de chapa: durante o cálculo, as peças da chapa maior deixam de ser cortadas na tela, e a imagem final desenha cada chapa no seu tamanho.
- Opção «Desenhar contorno da chapa na exportação»: o texto de ajuda agora diz o que ela faz: adiciona uma moldura em volta das peças colocadas (camada OUT_SHAPE). O contorno da chapa está sempre no arquivo.

*IT*

- Novità: lamiera importata da un DXF. In un progetto «Questo dispositivo», il pulsante «Importa una lamiera (DXF)» legge il contorno di una lamiera di forma qualsiasi: disco, ritaglio, piastra con intagli. Il nesting resta dentro il contorno reale. Cerchi, archi, ellissi, curve e polilinee ad archi vengono letti.
- Zone vietate: nella finestra di importazione, ogni contorno interno del disegno si può cliccare per diventare una zona vietata (foro già tagliato, difetto, posizione di una staffa). Nessun pezzo vi viene posato. Nulla è vietato finché non lo scegli, e le zone si modificano poi dalla riga della lamiera.
- Riprendere un ritaglio: il file di taglio di una lamiera importata si importa a sua volta come lamiera. I pezzi già tagliati vi compaiono come contorni interni e si possono vietare con un clic; il calcolo successivo non vi posa nulla.
- Risultato di una lamiera importata: l'anteprima, la miniatura nell'elenco dei risultati e la vista durante il calcolo disegnano il contorno reale, con le zone vietate in rosso. La densità è misurata sulla superficie reale della lamiera. Un controllo «Zone vietate libere» si aggiunge ai controlli esistenti, e il ritaglio rettangolare non viene più annunciato per queste lamiere.
- File di taglio di una lamiera importata: il contorno reale è sul livello BIN_BOUNDARY e le zone vietate sul livello FORBIDDEN_ZONE, da escludere dal taglio nel tuo software di comando. Lo zero resta nell'angolo in basso a sinistra del rettangolo che racchiude la lamiera. La cornice attorno ai pezzi (livello OUT_SHAPE) non viene disegnata su queste lamiere.
- La forma della lamiera resta nel tuo browser, come i tuoi pezzi: non viene inviata.
- Piano Free: importi la lamiera, segni le zone, fai il nesting e vedi l'anteprima, i controlli e la densità. I file di taglio di questi calcoli (DXF, ZIP, .job SheetCam) e la vista DXF richiedono il piano Unlimited; riprendere un ritaglio passa dal file di taglio scaricato, quindi richiede Unlimited.
- Calcolo con due formati di lamiera: durante il calcolo, i pezzi della lamiera più grande non vengono più tagliati sullo schermo, e l'immagine finale disegna ogni lamiera alla sua dimensione.
- Opzione «Disegna il contorno della lamiera all'esportazione»: il suo testo di aiuto ora dice cosa fa: aggiunge una cornice attorno ai pezzi posizionati (livello OUT_SHAPE). Il contorno della lamiera è sempre nel file.

*DE*

- Neu: aus einer DXF-Datei importiertes Blech. In einem Projekt „Dieses Gerät“ liest die Schaltfläche „Blech importieren (DXF)“ die Kontur eines Blechs beliebiger Form: Scheibe, Restblech, Platte mit Aussparungen. Die Verschachtelung bleibt innerhalb der echten Kontur. Kreise, Bögen, Ellipsen, Kurven und Polylinien mit Bögen werden gelesen.
- Gesperrte Zonen: Im Importfenster lässt sich jede Innenkontur der Zeichnung anklicken und wird zur gesperrten Zone (bereits geschnittenes Loch, Fehlstelle, Position einer Spannpratze). Es wird kein Teil darauf gelegt. Nichts ist gesperrt, solange Sie es nicht gewählt haben, und die Zonen lassen sich danach über die Zeile des Blechs ändern.
- Restblech weiterverwenden: Die Schnittdatei eines importierten Blechs lässt sich ihrerseits als Blech importieren. Die bereits geschnittenen Teile erscheinen darin als Innenkonturen und werden mit einem Klick gesperrt; die nächste Berechnung legt nichts darauf.
- Ergebnis eines importierten Blechs: Die Vorschau, die Miniaturansicht in der Ergebnisliste und die Ansicht während der Berechnung zeichnen die echte Kontur, mit den gesperrten Zonen in Rot. Die Dichte wird auf der tatsächlichen Fläche des Blechs gemessen. Eine Prüfung „Gesperrte Zonen frei“ kommt zu den bestehenden Prüfungen hinzu, und das rechteckige Restblech wird für diese Bleche nicht mehr angezeigt.
- Schnittdatei eines importierten Blechs: Die echte Kontur liegt auf der Ebene BIN_BOUNDARY und die gesperrten Zonen auf der Ebene FORBIDDEN_ZONE; beide schließen Sie in Ihrer Maschinensoftware vom Schneiden aus. Der Nullpunkt bleibt die untere linke Ecke des Rechtecks um das Blech. Der Rahmen um die Teile (Ebene OUT_SHAPE) wird auf diesen Blechen nicht gezeichnet.
- Die Form des Blechs bleibt in Ihrem Browser, wie Ihre Teile: Sie wird nicht gesendet.
- Free-Plan: Sie importieren das Blech, markieren die Zonen, verschachteln und sehen die Vorschau, die Prüfungen und die Dichte. Die Schnittdateien dieser Berechnungen (DXF, ZIP, SheetCam-.job) und die DXF-Ansicht erfordern den Unlimited-Plan; ein Restblech weiterzuverwenden geht über die heruntergeladene Schnittdatei und erfordert daher Unlimited.
- Berechnung mit zwei Blechformaten: Während der Berechnung werden die Teile des größeren Blechs auf dem Bildschirm nicht mehr abgeschnitten, und das Endbild zeichnet jedes Blech in seiner Größe.
- Option „Blechkontur im Export zeichnen“: Der Hilfetext sagt jetzt, was sie tut: Sie fügt einen Rahmen um die platzierten Teile hinzu (Ebene OUT_SHAPE). Die Blechkontur ist immer in der Datei.

*ES*

- Novedad: chapa importada de un DXF. En un proyecto «Este dispositivo», el botón «Importar una chapa (DXF)» lee el contorno de una chapa de cualquier forma: disco, sobrante, placa con muescas. El anidado se queda dentro del contorno real. Se leen círculos, arcos, elipses, curvas y polilíneas con arcos.
- Zonas prohibidas: en la ventana de importación, cada contorno interior del dibujo se puede pulsar para convertirse en una zona prohibida (agujero ya cortado, defecto, posición de una brida). No se coloca ninguna pieza en ella. Nada está prohibido hasta que lo elijas, y las zonas se modifican después desde la fila de la chapa.
- Reutilizar un sobrante: el archivo de corte de una chapa importada se puede importar a su vez como chapa. Las piezas ya cortadas aparecen en él como contornos interiores y se prohíben con un clic; el cálculo siguiente no coloca nada sobre ellas.
- Resultado de una chapa importada: la vista previa, la miniatura de la lista de resultados y la vista durante el cálculo dibujan el contorno real, con las zonas prohibidas en rojo. La densidad se mide sobre la superficie real de la chapa. Una comprobación «Zonas prohibidas libres» se suma a las existentes, y el sobrante rectangular ya no se anuncia para estas chapas.
- Archivo de corte de una chapa importada: el contorno real está en la capa BIN_BOUNDARY y las zonas prohibidas en la capa FORBIDDEN_ZONE, que debes excluir del corte en tu software de control. El cero sigue en la esquina inferior izquierda del rectángulo que rodea la chapa. El marco alrededor de las piezas (capa OUT_SHAPE) no se dibuja en estas chapas.
- La forma de la chapa se queda en tu navegador, como tus piezas: no se envía.
- Plan Free: importas la chapa, marcas las zonas, haces el anidado y ves la vista previa, las comprobaciones y la densidad. Los archivos de corte de estos cálculos (DXF, ZIP, .job de SheetCam) y la vista DXF requieren el plan Unlimited; reutilizar un sobrante pasa por el archivo de corte descargado, por lo que requiere Unlimited.
- Cálculo con dos formatos de chapa: durante el cálculo, las piezas de la chapa más grande ya no se recortan en pantalla, y la imagen final dibuja cada chapa a su tamaño.
- Opción «Dibujar el contorno de la chapa en la exportación»: su texto de ayuda ahora dice lo que hace: añade un marco alrededor de las piezas colocadas (capa OUT_SHAPE). El contorno de la chapa está siempre en el archivo.

## V0.9.16

*FR*

- Import : un éclat de dessin plus fin que 0,1 mm (souvent un contour refermé presque sur lui-même) pouvait être gardé comme une pièce. Le calcul refusait alors toute l'imbrication. Une telle pièce est maintenant écartée à l'import, sur l'appareil comme sur le serveur et quel que soit son sens dans le dessin, avec le message « pièces trop petites pour être découpées ont été écartées ». Les autres pièces s'imbriquent normalement.
- Import sur le serveur : quand un fichier ne contient aucune pièce, la fiche en erreur en donne maintenant la raison (« Aucune pièce fermée trouvée dans ce fichier. »).
- « Éclater en pièces », sur une fiche importée par le serveur, ne crée plus de fiche pour une pièce écartée.

*EN*

- Import: a drawing sliver thinner than 0.1 mm (often an outline closed almost onto itself) could be kept as a part. The nesting was then refused as a whole. Such a part is now dropped at import, on the device and on the server alike and whatever its direction in the drawing, with the message "parts too small to cut were dropped". The other parts nest normally.
- Import on the server: when a file holds no part, the error card now gives the reason ("No closed part found in this file.").
- "Split into parts", on a card imported by the server, no longer creates a card for a dropped part.

*PT*

- Importação: uma lasca de desenho mais fina que 0,1 mm (muitas vezes um contorno fechado quase sobre si mesmo) podia ser mantida como uma peça. O cálculo recusava então todo o encaixe. Uma peça assim agora é descartada na importação, tanto no aparelho quanto no servidor e qualquer que seja o seu sentido no desenho, com a mensagem «peças pequenas demais para cortar foram descartadas». As outras peças são encaixadas normalmente.
- Importação no servidor: quando um arquivo não contém nenhuma peça, a ficha em erro agora diz o motivo («Nenhuma peça fechada encontrada neste arquivo.»).
- «Separar em peças», numa ficha importada pelo servidor, não cria mais uma ficha para uma peça descartada.

*IT*

- Importazione: una scheggia di disegno più sottile di 0,1 mm (spesso un contorno richiuso quasi su se stesso) poteva essere tenuta come un pezzo. Il calcolo rifiutava allora tutto il nesting. Un pezzo così viene ora scartato all'importazione, sul dispositivo come sul server e qualunque sia il suo verso nel disegno, con il messaggio «pezzi troppo piccoli per essere tagliati sono stati scartati». Gli altri pezzi vengono inseriti normalmente.
- Importazione sul server: quando un file non contiene nessun pezzo, la scheda in errore ne indica ora il motivo («Nessun pezzo chiuso trovato in questo file.»).
- «Separa in pezzi», su una scheda importata dal server, non crea più una scheda per un pezzo scartato.

*DE*

- Import: Ein Zeichnungssplitter, der dünner als 0,1 mm ist (oft eine Kontur, die fast auf sich selbst geschlossen ist), konnte als Teil behalten werden. Die Berechnung lehnte dann die gesamte Verschachtelung ab. Ein solches Teil wird jetzt beim Import verworfen, auf dem Gerät wie auf dem Server und unabhängig von seiner Richtung in der Zeichnung, mit der Meldung „zu kleine Teile wurden verworfen“. Die anderen Teile werden normal verschachtelt.
- Import auf dem Server: Wenn eine Datei kein Teil enthält, nennt die Fehlerkarte jetzt den Grund („Kein geschlossenes Teil in dieser Datei gefunden.“).
- „In Einzelteile zerlegen“ erzeugt bei einer vom Server importierten Karte keine Karte mehr für ein verworfenes Teil.

*ES*

- Importación: una esquirla de dibujo más fina que 0,1 mm (a menudo un contorno cerrado casi sobre sí mismo) podía conservarse como una pieza. El cálculo rechazaba entonces todo el anidado. Una pieza así ahora se descarta en la importación, tanto en el dispositivo como en el servidor y sea cual sea su sentido en el dibujo, con el mensaje «piezas demasiado pequeñas para cortar han sido descartadas». Las demás piezas se anidan con normalidad.
- Importación en el servidor: cuando un archivo no contiene ninguna pieza, la ficha en error indica ahora el motivo («No se ha encontrado ninguna pieza cerrada en este archivo.»).
- «Separar en piezas», en una ficha importada por el servidor, ya no crea una ficha para una pieza descartada.

## V0.9.15

*FR*

- « Imbriquer dans les trous », pièces à paroi fine, lettres et plaques très ajourées : pour rendre un trou utilisable, l'application ouvre un passage étroit entre le trou et le bord de la pièce. Sur une paroi fine, un trait de lettre ou entre deux trous voisins, ce passage pouvait effacer de la matière ou couper la pièce en morceaux pour le calcul. Une autre pièce pouvait alors être posée trop près, ou l'imbrication était refusée au contrôle final (« chevauchements mesurés ») et remboursée. Un trou n'est maintenant ouvert que si son passage n'abîme pas la pièce. Sinon il reste fermé pendant le calcul ; de petites pièces peuvent encore y être rangées à la fin.
- Import sur l'appareil : dans un petit dessin, une pièce dont le contour est touché par un trait ouvert (ligne de pliage ou de gravure) pouvait disparaître. Elle est maintenant lue comme sur le serveur.

*EN*

- "Nest parts inside holes", parts with thin walls, letters and plates with many holes: to make a hole usable, the application opens a narrow passage between the hole and the edge of the part. On a thin wall, a letter stroke or between two neighbouring holes, this passage could erase material or cut the part into pieces for the nesting. Another part could then be placed too close, or the nesting was refused by the final check ("measured overlaps") and refunded. A hole is now opened only if its passage does not damage the part. Otherwise it stays closed during the nesting; small parts can still be put into it at the end.
- Import on the device: in a small drawing, a part whose outline is touched by an open line (bend or engraving line) could disappear. It is now read as on the server.

*PT*

- Encaixe de peças nos furos, peças de parede fina, letras e chapas muito vazadas: para tornar um furo utilizável, o aplicativo abre uma passagem estreita entre o furo e a borda da peça. Numa parede fina, num traço de letra ou entre dois furos vizinhos, essa passagem podia apagar material ou cortar a peça em pedaços para o cálculo. Outra peça podia então ser colocada perto demais, ou o encaixe era recusado na verificação final («sobreposições medidas») e reembolsado. Um furo agora só é aberto se a passagem não danificar a peça. Caso contrário ele fica fechado durante o cálculo; peças pequenas ainda podem ser colocadas nele no final.
- Importação no aparelho: num desenho pequeno, uma peça cujo contorno é tocado por um traço aberto (linha de dobra ou de gravação) podia desaparecer. Agora ela é lida como no servidor.

*IT*

- Inserimento dei pezzi nei fori, pezzi con parete sottile, lettere e lamiere molto forate: per rendere utilizzabile un foro, l'applicazione apre un passaggio stretto tra il foro e il bordo del pezzo. Su una parete sottile, un tratto di lettera o tra due fori vicini, questo passaggio poteva cancellare del materiale o tagliare il pezzo in più parti per il calcolo. Un altro pezzo poteva allora essere posato troppo vicino, oppure il nesting veniva rifiutato dal controllo finale («sovrapposizioni misurate») e rimborsato. Un foro viene ora aperto solo se il suo passaggio non danneggia il pezzo. Altrimenti resta chiuso durante il calcolo; dei pezzi piccoli possono ancora esservi inseriti alla fine.
- Importazione sul dispositivo: in un disegno piccolo, un pezzo il cui contorno è toccato da un tratto aperto (linea di piega o di incisione) poteva sparire. Ora viene letto come sul server.

*DE*

- Teile in Löchern verschachteln, Teile mit dünner Wand, Buchstaben und stark durchbrochene Tafeln: Um ein Loch nutzbar zu machen, öffnet die Anwendung einen schmalen Durchgang zwischen dem Loch und dem Rand des Teils. An einer dünnen Wand, einem Buchstabenstrich oder zwischen zwei benachbarten Löchern konnte dieser Durchgang Material entfernen oder das Teil für die Berechnung in Stücke schneiden. Ein anderes Teil konnte dann zu nah platziert werden, oder die Verschachtelung wurde bei der Endprüfung abgelehnt („gemessene Überlappungen“) und erstattet. Ein Loch wird jetzt nur geöffnet, wenn sein Durchgang das Teil nicht beschädigt. Andernfalls bleibt es während der Berechnung geschlossen; kleine Teile können am Ende trotzdem noch hineingelegt werden.
- Import auf dem Gerät: In einer kleinen Zeichnung konnte ein Teil verschwinden, dessen Kontur von einer offenen Linie (Biege- oder Gravurlinie) berührt wird. Es wird jetzt wie auf dem Server gelesen.

*ES*

- Anidado de piezas en los agujeros, piezas de pared fina, letras y chapas muy caladas: para que un agujero se pueda usar, la aplicación abre un paso estrecho entre el agujero y el borde de la pieza. En una pared fina, un trazo de letra o entre dos agujeros vecinos, ese paso podía borrar material o cortar la pieza en trozos para el cálculo. Otra pieza podía entonces colocarse demasiado cerca, o el anidado se rechazaba en la comprobación final («solapamientos medidos») y se reembolsaba. Ahora un agujero solo se abre si su paso no daña la pieza. Si no, queda cerrado durante el cálculo; al final todavía se pueden colocar piezas pequeñas en él.
- Importación en el dispositivo: en un dibujo pequeño, una pieza cuyo contorno es tocado por un trazo abierto (línea de plegado o de grabado) podía desaparecer. Ahora se lee como en el servidor.

## V0.9.14

*FR*

- Dessins éclatés en pièces, cadres à paroi très fine : dans un calcul fait sur l'appareil, un cadre dont la paroi fait moins de 0,7 mm environ n'était pas reconnu comme une pièce. Ses tracés partaient avec la petite pièce dessinée en son milieu, et le fichier de coupe pouvait contenir des tracés posés sur d'autres pièces ou hors de la tôle alors que le rapport était vert. Le cadre est maintenant une pièce à part entière, placée et contrôlée comme les autres.
- Pièces dont une découpe passe très près d'un bord : sur l'appareil, une telle pièce pouvait disparaître à l'import. Elle est maintenant lue comme sur le serveur.
- « Imbriquer dans les trous » : sur certaines pièces, la zone réservée à la pièce débordait dans une de ses découpes. Ce débordement est corrigé.

*EN*

- Drawings split into parts, frames with a very thin wall: in a nesting run on the device, a frame whose wall is thinner than about 0.7 mm was not recognised as a part. Its lines travelled with the small part drawn in its middle, and the cut file could contain lines lying over other parts or outside the sheet while the report was green. The frame is now a part of its own, placed and checked like the others.
- Parts with a cutout very close to an edge: on the device, such a part could disappear at import. It is now read as on the server.
- "Nest parts inside holes": on some parts, the area reserved for the part spilled into one of its cutouts. This spill is fixed.

*PT*

- Desenhos separados em peças, molduras de parede muito fina: num cálculo feito no aparelho, uma moldura com parede de menos de cerca de 0,7 mm não era reconhecida como peça. Os seus traços seguiam com a pequena peça desenhada no meio, e o arquivo de corte podia conter traços sobre outras peças ou fora da chapa enquanto o relatório estava verde. A moldura agora é uma peça própria, posicionada e verificada como as outras.
- Peças com um recorte muito perto de uma borda: no aparelho, uma peça assim podia desaparecer na importação. Agora ela é lida como no servidor.
- Encaixe de peças nos furos: em algumas peças, a área reservada para a peça invadia um dos seus recortes. Essa invasão foi corrigida.

*IT*

- Disegni separati in pezzi, cornici con parete molto sottile: in un calcolo fatto sul dispositivo, una cornice con parete inferiore a circa 0,7 mm non era riconosciuta come pezzo. I suoi tracciati seguivano il piccolo pezzo disegnato al suo interno, e il file di taglio poteva contenere tracciati sopra altri pezzi o fuori dalla lamiera mentre il rapporto era verde. La cornice è ora un pezzo a sé, posizionato e controllato come gli altri.
- Pezzi con un'apertura molto vicina a un bordo: sul dispositivo, un pezzo di questo tipo poteva sparire all'importazione. Ora viene letto come sul server.
- Inserimento dei pezzi nei fori: su alcuni pezzi, la zona riservata al pezzo sconfinava in una delle sue aperture. Questo sconfinamento è corretto.

*DE*

- In Teile zerlegte Zeichnungen, Rahmen mit sehr dünner Wand: Bei einer Berechnung auf dem Gerät wurde ein Rahmen mit einer Wandstärke unter etwa 0,7 mm nicht als Teil erkannt. Seine Linien wanderten mit dem kleinen Teil, das in seiner Mitte gezeichnet ist, und die Schneiddatei konnte Linien über anderen Teilen oder außerhalb der Tafel enthalten, während der Bericht grün war. Der Rahmen ist jetzt ein eigenes Teil, das wie die anderen platziert und geprüft wird.
- Teile mit einem Ausschnitt sehr nah an einer Kante: Auf dem Gerät konnte ein solches Teil beim Import verschwinden. Es wird jetzt wie auf dem Server gelesen.
- Teile in Löchern verschachteln: Bei manchen Teilen ragte der für das Teil reservierte Bereich in einen seiner Ausschnitte hinein. Das ist behoben.

*ES*

- Dibujos separados en piezas, marcos de pared muy fina: en un cálculo hecho en el dispositivo, un marco con una pared de menos de unos 0,7 mm no se reconocía como pieza. Sus trazos se iban con la pieza pequeña dibujada en su centro, y el archivo de corte podía contener trazos sobre otras piezas o fuera de la chapa mientras el informe estaba en verde. El marco es ahora una pieza propia, colocada y comprobada como las demás.
- Piezas con un recorte muy cerca de un borde: en el dispositivo, una pieza así podía desaparecer al importar. Ahora se lee como en el servidor.
- Anidado de piezas en los agujeros: en algunas piezas, la zona reservada para la pieza invadía uno de sus recortes. Esa invasión está corregida.

## V0.9.13

*FR*

- Espacement tenu sur toutes les pièces : sur certaines pièces, la marge calculée autour de la pièce était un peu plus petite que demandé, et deux pièces pouvaient se retrouver à 1,95 mm pour 2 mm demandés. L'espacement demandé est maintenant tenu. Sur ces pièces le calcul peut prendre un peu plus de temps.
- Pièces en spirale ou à traits très fins : deux pièces de ce type pouvaient être posées l'une contre l'autre sans avertissement. Elles gardent maintenant l'espacement demandé, et l'application les nomme pour que vous les vérifiiez avant de découper.
- Avertissement sur les pièces à traits fins : il ne s'affichait plus dans le rapport depuis la V0.9.9. Il s'affiche de nouveau, pour un calcul sur l'appareil comme sur le serveur, et il nomme les bons fichiers même quand des pièces sont rangées dans les trous d'autres pièces.
- Choix du meilleur résultat : quand le contrôle final retire une pièce d'une disposition, cette disposition ne passe plus devant une disposition complète.

*EN*

- Spacing held on every part: on some parts, the margin computed around the part was slightly smaller than requested, and two parts could end up 1.95 mm apart for 2 mm requested. The requested spacing is now held. On these parts the nesting can take a little longer.
- Spiral parts or parts with very thin strokes: two such parts could be placed against each other without any warning. They now keep the requested spacing, and the application names them so that you can check them before cutting.
- Warning about parts with thin strokes: it had stopped showing in the report since V0.9.9. It shows again, for a nesting on the device as well as on the server, and it names the right files even when parts are nested inside the holes of other parts.
- Choice of the best result: when the final check removes a part from a layout, that layout no longer ranks ahead of a complete layout.

*PT*

- Espaçamento mantido em todas as peças: em algumas peças, a margem calculada em volta da peça era um pouco menor do que o pedido, e duas peças podiam ficar a 1,95 mm para 2 mm pedidos. O espaçamento pedido agora é respeitado. Nessas peças o cálculo pode demorar um pouco mais.
- Peças em espiral ou com traços muito finos: duas peças deste tipo podiam ser colocadas uma contra a outra sem aviso. Agora mantêm o espaçamento pedido, e o aplicativo informa o nome delas para que você as verifique antes de cortar.
- Aviso sobre peças com traços finos: ele não aparecia mais no relatório desde a V0.9.9. Ele volta a aparecer, tanto num cálculo no aparelho como no servidor, e informa os arquivos certos mesmo quando há peças encaixadas nos furos de outras peças.
- Escolha do melhor resultado: quando a verificação final retira uma peça de uma disposição, essa disposição não passa mais à frente de uma disposição completa.

*IT*

- Spaziatura mantenuta su tutti i pezzi: su alcuni pezzi, il margine calcolato attorno al pezzo era leggermente più piccolo del richiesto, e due pezzi potevano trovarsi a 1,95 mm per 2 mm richiesti. La spaziatura richiesta è ora rispettata. Su questi pezzi il calcolo può richiedere un po' più di tempo.
- Pezzi a spirale o con tratti molto sottili: due pezzi di questo tipo potevano essere posati uno contro l'altro senza avviso. Ora mantengono la spaziatura richiesta, e l'applicazione li nomina perché possiate verificarli prima del taglio.
- Avviso sui pezzi con tratti sottili: non compariva più nel rapporto dalla V0.9.9. Ora compare di nuovo, per un calcolo sul dispositivo come sul server, e nomina i file giusti anche quando dei pezzi sono inseriti nei fori di altri pezzi.
- Scelta del risultato migliore: quando il controllo finale toglie un pezzo da una disposizione, quella disposizione non passa più davanti a una disposizione completa.

*DE*

- Abstand bei allen Teilen eingehalten: Bei manchen Teilen war der um das Teil berechnete Rand etwas kleiner als gewünscht, und zwei Teile konnten bei gewünschten 2 mm nur 1,95 mm auseinanderliegen. Der gewünschte Abstand wird jetzt eingehalten. Bei diesen Teilen kann die Berechnung etwas länger dauern.
- Spiralförmige Teile oder Teile mit sehr dünnen Linien: Zwei solche Teile konnten ohne Warnung aneinandergelegt werden. Sie halten jetzt den gewünschten Abstand ein, und die Anwendung nennt sie, damit Sie sie vor dem Schneiden prüfen können.
- Warnung zu Teilen mit dünnen Linien: Sie erschien seit V0.9.9 nicht mehr im Bericht. Sie erscheint jetzt wieder, bei einer Berechnung auf dem Gerät wie auf dem Server, und nennt die richtigen Dateien, auch wenn Teile in den Löchern anderer Teile liegen.
- Wahl des besten Ergebnisses: Wenn die Schlusskontrolle ein Teil aus einer Anordnung entfernt, steht diese Anordnung nicht mehr vor einer vollständigen Anordnung.

*ES*

- Espaciado mantenido en todas las piezas: en algunas piezas, el margen calculado alrededor de la pieza era un poco menor de lo pedido, y dos piezas podían quedar a 1,95 mm para 2 mm pedidos. El espaciado pedido se respeta ahora. En esas piezas el cálculo puede tardar un poco más.
- Piezas en espiral o con trazos muy finos: dos piezas de este tipo podían colocarse una contra otra sin aviso. Ahora mantienen el espaciado pedido, y la aplicación las nombra para que las compruebe antes de cortar.
- Aviso sobre piezas con trazos finos: había dejado de mostrarse en el informe desde la V0.9.9. Vuelve a mostrarse, tanto en un cálculo en el dispositivo como en el servidor, y nombra los archivos correctos incluso cuando hay piezas colocadas en los huecos de otras piezas.
- Elección del mejor resultado: cuando el control final retira una pieza de una disposición, esa disposición ya no pasa por delante de una disposición completa.

## V0.9.12

*FR*

- Petits travaux : quelques petites pièces sur une grande tôle (un rectangle de 40 × 100 mm avec les réglages d'usine, par exemple) pouvaient arrêter le calcul. Ils aboutissent maintenant.
- Pièces qui ne tiennent pas : une pièce tout juste trop grande pour la tôle, ou juste à sa cote, est maintenant refusée en la nommant, au lieu d'un arrêt inexpliqué. Le calcul entier est alors refusé, même si les autres pièces tiennent : réduisez l'espacement, prenez une tôle plus grande ou retirez cette pièce, puis relancez.
- Calcul en échec : quand un calcul échoue, ou que le serveur refuse de le lancer (un autre calcul en cours, par exemple), le message apparaît maintenant à l'écran au lieu de rester plus bas dans la page, et vous pouvez relancer tout de suite.
- Calcul sur l'appareil : la vue en direct est amenée à l'écran dès le début du calcul, comme c'était déjà le cas sur le serveur.
- Dernière étape d'optimisation : si elle s'arrête, vos pièces sont quand même livrées, et une note sur la carte prévient que la disposition peut consommer plus de matière que d'habitude.
- Page de connexion par e-mail : elle s'ouvre maintenant sur la connexion, et non plus sur la création de compte.
- Résultat plus lisible : une seule densité partout (aire des pièces sur aire des tôles), le badge « Terminé » seulement quand le calcul est vraiment fini, la longueur de tôle utilisée pendant la recherche, des options nommées par leur sens, et le bloc « Matière à prévoir » en tête du rapport.
- Rapport : les deux boutons d'export s'appellent « Copier le rapport » et « Exporter CSV », et le tableau par tôle se lit sur téléphone.
- Refus et échecs : une pièce trop grande est signalée sous le bouton d'imbrication, avec la raison ; les messages venus du serveur sont traduits et nomment le fichier.
- Abonnement : la fenêtre dit ce que chaque offre débloque, que la carte est demandée, le montant et la date du premier prélèvement ; sur la page des offres, un compte gratuit peut démarrer l'essai d'Unlimited ou de Pro sans quitter la page.
- Fichier de coupe plus fidèle : les arcs des polylignes anciennes restent des arcs (ils sortaient en segments droits) ; les blocs à échelle inégale, en miroir ou répétés (MINSERT) sont importés à la bonne place ; en SVG, les formes cachées dans <defs> ne deviennent plus des pièces, <use> est pris en charge et une largeur en pourcentage garde la bonne échelle.
- Alertes à l'import : l'application prévient quand des traits ne seront pas découpés (entités hors de toute pièce, espace papier, textes et cotes) et quand des arcs de polyligne sont imbriqués comme des segments droits.
- Fichiers lourds ou abîmés : l'import est plus rapide, et un fichier corrompu est refusé ou ignoré proprement au lieu de figer l'onglet.
- Espacement tenu sur les courbes : l'espacement demandé est maintenant respecté sur les vraies courbes du fichier de coupe, grâce à une petite marge (0,12 mm au plus) ajoutée pour les pièces à courbes. Rien ne change pour les pièces à bords droits. Une pièce courbe calée exactement à la cote de la tôle peut être refusée : le message indique la marge.
- Bouton « Réduire l'espacement à X mm » : il applique bien X, et non plus la moitié.
- Page projet : les pièces et leurs quantités sont affichées en premier, le bouton d'imbrication reste visible, et après un calcul sur le serveur la vue centrale montre le résultat.
- Téléphone et thème sombre : l'en-tête et le tableau des offres tiennent sur un petit écran, et les textes illisibles du thème sombre sont corrigés.
- Nouveautés : cette page s'affiche maintenant dans les six langues.
- Fichiers par tôle du serveur : ils sont numérotés de 1 à N même quand un format de tôle reste vide.

*EN*

- Small jobs: a few small parts on a large sheet (a 40 × 100 mm rectangle with the factory settings, for example) could stop the nesting. They now complete.
- Parts that do not fit: a part just too large for the sheet, or right at its exact size, is now refused by name instead of an unexplained stop. The whole nesting is then refused, even if the other parts fit: reduce the spacing, use a larger sheet or remove that part, then start again.
- Failed nesting: when a nesting fails, or the server refuses to start it (another nesting already running, for example), the message now appears on screen instead of staying further down the page, and you can start again right away.
- On-device nesting: the live view is brought on screen as soon as the nesting starts, as it already was on the server.
- Final optimisation step: if it stops, your parts are still delivered, and a note on the card warns that the layout may use more material than usual.
- Email login page: it now opens on login rather than on account creation.
- Clearer result: a single density everywhere (area of the parts over area of the sheets), the "Done" badge only when the nesting is really finished, the sheet length used shown during the search, options named by what they mean, and the "Material to plan" block at the top of the report.
- Report: the two export buttons are called "Copy report" and "Export CSV", and the per-sheet table can be read on a phone.
- Refusals and failures: a part that is too large is flagged under the nesting button, with the reason; messages coming from the server are translated and name the file.
- Subscription: the window says what each plan unlocks, that a card is required, the amount and the date of the first charge; on the plans page, a free account can start the Unlimited or Pro trial without leaving the page.
- More faithful cutting file: the arcs of old polylines stay arcs (they used to come out as straight segments); blocks with uneven scale, mirrored or repeated (MINSERT) are imported in the right place; in SVG, shapes hidden in <defs> no longer become parts, <use> is supported and a width in percent keeps the right scale.
- Import warnings: the app warns when some lines will not be cut (entities outside any part, paper space, texts and dimensions) and when polyline arcs are nested as straight segments.
- Heavy or damaged files: import is faster, and a corrupted file is cleanly refused or ignored instead of freezing the tab.
- Spacing held on curves: the requested spacing is now respected on the real curves of the cutting file, thanks to a small margin (0.12 mm at most) added for parts with curves. Nothing changes for parts with straight edges. A curved part fitted exactly to the sheet size may be refused: the message states the margin.
- "Reduce spacing to X mm" button: it now applies X, not half of it.
- Project page: the parts and their quantities are shown first, the nesting button stays visible, and after a nesting on the server the central view shows the result.
- Phone and dark theme: the header and the plans table fit on a small screen, and the unreadable texts of the dark theme are fixed.
- What's new: this page is now shown in all six languages.
- Server sheet files: they are numbered from 1 to N even when a sheet format stays empty.

*PT*

- Trabalhos pequenos: algumas peças pequenas em uma chapa grande (um retângulo de 40 × 100 mm com as configurações de fábrica, por exemplo) podiam interromper o cálculo. Agora eles são concluídos.
- Peças que não cabem: uma peça um pouco grande demais para a chapa, ou exatamente na medida dela, agora é recusada pelo nome, em vez de uma parada sem explicação. O cálculo inteiro é então recusado, mesmo que as outras peças caibam: reduza o espaçamento, use uma chapa maior ou remova essa peça e reinicie.
- Cálculo com falha: quando um cálculo falha, ou o servidor se recusa a iniciá-lo (outro cálculo em andamento, por exemplo), a mensagem agora aparece na tela em vez de ficar mais abaixo na página, e você pode reiniciar em seguida.
- Cálculo no dispositivo: a visualização ao vivo é trazida para a tela assim que o cálculo começa, como já acontecia no servidor.
- Última etapa de otimização: se ela parar, suas peças continuam sendo entregues, e uma nota no cartão avisa que o layout pode usar mais material do que o normal.
- Página de login por e-mail: agora ela abre no login, e não mais na criação de conta.
- Resultado mais legível: uma única densidade em todo lugar (área das peças sobre área das chapas), o selo "Concluído" somente quando o cálculo realmente terminou, o comprimento de chapa usado durante a busca, opções nomeadas pelo seu sentido e o bloco "Material a prever" no topo do relatório.
- Relatório: os dois botões de exportação se chamam "Copiar relatório" e "Exportar CSV", e a tabela por chapa pode ser lida no celular.
- Recusas e falhas: uma peça grande demais é sinalizada sob o botão de cálculo, com o motivo; as mensagens vindas do servidor são traduzidas e citam o arquivo.
- Assinatura: a janela diz o que cada plano libera, que o cartão é solicitado, o valor e a data da primeira cobrança; na página dos planos, uma conta gratuita pode iniciar o teste do Unlimited ou do Pro sem sair da página.
- Arquivo de corte mais fiel: os arcos das polilinhas antigas continuam sendo arcos (saíam como segmentos retos); os blocos com escala desigual, espelhados ou repetidos (MINSERT) são importados no lugar certo; em SVG, as formas escondidas em <defs> não viram mais peças, <use> é suportado e uma largura em porcentagem mantém a escala certa.
- Alertas na importação: o aplicativo avisa quando traços não serão cortados (entidades fora de qualquer peça, espaço papel, textos e cotas) e quando arcos de polilinha são encaixados como segmentos retos.
- Arquivos pesados ou danificados: a importação é mais rápida, e um arquivo corrompido é recusado ou ignorado corretamente em vez de travar a aba.
- Espaçamento mantido nas curvas: o espaçamento pedido agora é respeitado nas curvas reais do arquivo de corte, graças a uma pequena margem (0,12 mm no máximo) adicionada para as peças com curvas. Nada muda para as peças de bordas retas. Uma peça curva ajustada exatamente à medida da chapa pode ser recusada: a mensagem indica a margem.
- Botão "Reduzir o espaçamento para X mm": ele aplica de fato X, e não mais a metade.
- Página do projeto: as peças e suas quantidades aparecem primeiro, o botão de cálculo continua visível e, depois de um cálculo no servidor, a visualização central mostra o resultado.
- Celular e tema escuro: o cabeçalho e a tabela dos planos cabem em uma tela pequena, e os textos ilegíveis do tema escuro foram corrigidos.
- Novidades: esta página agora é exibida nos seis idiomas.
- Arquivos por chapa do servidor: eles são numerados de 1 a N mesmo quando um formato de chapa fica vazio.

*IT*

- Lavori piccoli: pochi pezzi piccoli su una lamiera grande (per esempio un rettangolo di 40 × 100 mm con le impostazioni di fabbrica) potevano fermare il calcolo. Ora vanno a buon fine.
- Pezzi che non stanno: un pezzo appena troppo grande per la lamiera, o proprio alla sua misura esatta, ora viene rifiutato indicandone il nome, invece di un arresto senza spiegazione. L'intero calcolo viene allora rifiutato, anche se gli altri pezzi ci stanno: riduci la spaziatura, usa una lamiera più grande o rimuovi quel pezzo, poi rilancia.
- Calcolo non riuscito: quando un calcolo non riesce, o il server rifiuta di avviarlo (per esempio perché un altro calcolo è in corso), il messaggio ora compare sullo schermo invece di restare più in basso nella pagina, e puoi rilanciarlo subito.
- Calcolo sul dispositivo: la vista in diretta viene portata sullo schermo appena il calcolo parte, come già avveniva sul server.
- Ultima fase di ottimizzazione: se si ferma, i tuoi pezzi vengono comunque consegnati, e una nota sulla scheda avvisa che la disposizione può usare più materiale del solito.
- Pagina di accesso via email: ora si apre sull'accesso e non più sulla creazione dell'account.
- Risultato più leggibile: una sola densità ovunque (area dei pezzi sull'area delle lamiere), il badge "Completato" solo quando il calcolo è davvero finito, la lunghezza di lamiera usata durante la ricerca, opzioni chiamate col loro significato e il blocco "Materiale da pianificare" in testa al rapporto.
- Rapporto: i due pulsanti di esportazione si chiamano "Copia il rapporto" ed "Esporta CSV", e la tabella per lamiera si legge su telefono.
- Rifiuti e errori: un pezzo troppo grande viene segnalato sotto il pulsante di calcolo, con il motivo; i messaggi che arrivano dal server sono tradotti e indicano il file.
- Abbonamento: la finestra dice cosa sblocca ogni piano, che la carta viene richiesta, l'importo e la data del primo addebito; nella pagina dei piani, un account gratuito può avviare la prova di Unlimited o di Pro senza lasciare la pagina.
- File di taglio più fedele: gli archi delle polilinee vecchie restano archi (uscivano come segmenti retti); i blocchi con scala disuguale, speculari o ripetuti (MINSERT) vengono importati nel punto giusto; in SVG, le forme nascoste in <defs> non diventano più pezzi, <use> è supportato e una larghezza in percentuale mantiene la scala giusta.
- Avvisi all'importazione: l'applicazione avvisa quando alcuni tratti non verranno tagliati (entità fuori da ogni pezzo, spazio carta, testi e quote) e quando gli archi di polilinea vengono disposti come segmenti retti.
- File pesanti o danneggiati: l'importazione è più veloce, e un file corrotto viene rifiutato o ignorato correttamente invece di bloccare la scheda.
- Spaziatura mantenuta sulle curve: la spaziatura richiesta è ora rispettata sulle vere curve del file di taglio, grazie a un piccolo margine (0,12 mm al massimo) aggiunto per i pezzi con curve. Non cambia nulla per i pezzi con bordi retti. Un pezzo curvo portato esattamente alla misura della lamiera può essere rifiutato: il messaggio indica il margine.
- Pulsante "Riduci la spaziatura a X mm": applica davvero X, e non più la metà.
- Pagina del progetto: i pezzi e le loro quantità vengono mostrati per primi, il pulsante di calcolo resta visibile e, dopo un calcolo sul server, la vista centrale mostra il risultato.
- Telefono e tema scuro: l'intestazione e la tabella dei piani stanno su uno schermo piccolo, e i testi illeggibili del tema scuro sono stati corretti.
- Novità: questa pagina ora viene mostrata nelle sei lingue.
- File per lamiera del server: sono numerati da 1 a N anche quando un formato di lamiera resta vuoto.

*DE*

- Kleine Aufträge: Einige kleine Teile auf einem großen Blech (zum Beispiel ein Rechteck von 40 × 100 mm mit den Werkseinstellungen) konnten die Berechnung stoppen. Sie werden jetzt abgeschlossen.
- Teile, die nicht passen: Ein Teil, das knapp zu groß für das Blech ist oder genau dem Blechmaß entspricht, wird jetzt mit seinem Namen abgelehnt statt mit einem unerklärten Abbruch. Die gesamte Berechnung wird dann abgelehnt, auch wenn die anderen Teile passen: Verringern Sie den Abstand, wählen Sie ein größeres Blech oder entfernen Sie dieses Teil und starten Sie neu.
- Fehlgeschlagene Berechnung: Wenn eine Berechnung fehlschlägt oder der Server sie nicht startet (zum Beispiel weil bereits eine andere läuft), erscheint die Meldung jetzt auf dem Bildschirm, statt weiter unten auf der Seite zu bleiben, und Sie können sofort neu starten.
- Berechnung auf dem Gerät: Die Live-Ansicht wird gleich beim Start der Berechnung auf den Bildschirm geholt, wie schon auf dem Server.
- Letzter Optimierungsschritt: Wenn er abbricht, werden Ihre Teile trotzdem geliefert, und ein Hinweis auf der Karte warnt, dass die Anordnung mehr Material als üblich verbrauchen kann.
- Seite für die E-Mail-Anmeldung: Sie öffnet sich jetzt bei der Anmeldung statt bei der Kontoerstellung.
- Besser lesbares Ergebnis: überall nur eine Dichte (Fläche der Teile im Verhältnis zur Fläche der Bleche), das Kennzeichen „Fertig“ nur, wenn die Berechnung wirklich abgeschlossen ist, die verwendete Blechlänge schon während der Suche, Optionen mit sprechenden Namen und der Block „Zu planendes Material“ am Anfang des Berichts.
- Bericht: Die beiden Export-Schaltflächen heißen „Bericht kopieren“ und „CSV-Export“, und die Tabelle pro Blech lässt sich auf dem Smartphone lesen.
- Ablehnungen und Fehler: Ein zu großes Teil wird unter der Schaltfläche zur Berechnung mit dem Grund angezeigt; Meldungen vom Server werden übersetzt und nennen die Datei.
- Abo: Das Fenster sagt, was jedes Angebot freischaltet, dass die Karte verlangt wird, den Betrag und das Datum der ersten Abbuchung; auf der Angebotsseite kann ein kostenloses Konto die Testphase von Unlimited oder Pro starten, ohne die Seite zu verlassen.
- Genauere Schneiddatei: Die Bögen alter Polylinien bleiben Bögen (sie kamen als gerade Segmente heraus); Blöcke mit ungleichem Maßstab, gespiegelte oder wiederholte Blöcke (MINSERT) werden an der richtigen Stelle importiert; bei SVG werden in <defs> versteckte Formen nicht mehr zu Teilen, <use> wird unterstützt und eine Breite in Prozent behält den richtigen Maßstab.
- Warnungen beim Import: Die Anwendung warnt, wenn Linien nicht geschnitten werden (Objekte außerhalb jedes Teils, Papierbereich, Texte und Bemaßungen) und wenn Polylinienbögen wie gerade Segmente verschachtelt werden.
- Große oder beschädigte Dateien: Der Import ist schneller, und eine beschädigte Datei wird sauber abgelehnt oder übergangen, statt den Tab einzufrieren.
- Abstand auf Kurven eingehalten: Der gewünschte Abstand wird jetzt auf den echten Kurven der Schneiddatei eingehalten, dank einer kleinen Zugabe (höchstens 0,12 mm) für Teile mit Kurven. Bei Teilen mit geraden Kanten ändert sich nichts. Ein gekrümmtes Teil, das genau auf das Blechmaß passt, kann abgelehnt werden: Die Meldung nennt die Zugabe.
- Schaltfläche „Abstand auf X mm verringern“: Sie wendet jetzt tatsächlich X an, nicht mehr die Hälfte.
- Projektseite: Die Teile und ihre Mengen werden zuerst angezeigt, die Schaltfläche zur Berechnung bleibt sichtbar, und nach einer Berechnung auf dem Server zeigt die zentrale Ansicht das Ergebnis.
- Smartphone und dunkles Design: Die Kopfzeile und die Angebotstabelle passen auf einen kleinen Bildschirm, und die unlesbaren Texte im dunklen Design sind korrigiert.
- Neuigkeiten: Diese Seite wird jetzt in allen sechs Sprachen angezeigt.
- Serverdateien pro Blech: Sie werden von 1 bis N nummeriert, auch wenn ein Blechformat leer bleibt.

*ES*

- Trabajos pequeños: unas pocas piezas pequeñas en una chapa grande (un rectángulo de 40 × 100 mm con los ajustes de fábrica, por ejemplo) podían detener el cálculo. Ahora se completan.
- Piezas que no caben: una pieza apenas demasiado grande para la chapa, o justo a su medida, ahora se rechaza nombrándola, en lugar de una parada sin explicación. Entonces se rechaza todo el cálculo, aunque las demás piezas quepan: reduce el espaciado, usa una chapa más grande o retira esa pieza y relanza.
- Cálculo fallido: cuando un cálculo falla, o el servidor se niega a iniciarlo (por ejemplo, porque hay otro en curso), el mensaje aparece ahora en pantalla en lugar de quedarse más abajo en la página, y puedes relanzarlo enseguida.
- Cálculo en el dispositivo: la vista en directo se trae a la pantalla en cuanto empieza el cálculo, como ya ocurría en el servidor.
- Última etapa de optimización: si se detiene, tus piezas se entregan igualmente, y una nota en la tarjeta avisa de que la disposición puede usar más material de lo habitual.
- Página de acceso por correo electrónico: ahora se abre en el acceso y ya no en la creación de cuenta.
- Resultado más legible: una sola densidad en todas partes (área de las piezas sobre área de las chapas), la insignia «Completado» solo cuando el cálculo ha acabado de verdad, la longitud de chapa usada durante la búsqueda, opciones con nombres que dicen su sentido y el bloque «Material que planificar» al principio del informe.
- Informe: los dos botones de exportación se llaman «Copiar informe» y «Exportar CSV», y la tabla por chapa se lee en el teléfono.
- Rechazos y fallos: una pieza demasiado grande se señala bajo el botón de cálculo, con el motivo; los mensajes que llegan del servidor se traducen y nombran el archivo.
- Suscripción: la ventana dice qué desbloquea cada plan, que se pide la tarjeta, el importe y la fecha del primer cobro; en la página de planes, una cuenta gratuita puede iniciar la prueba de Unlimited o de Pro sin salir de la página.
- Archivo de corte más fiel: los arcos de las polilíneas antiguas siguen siendo arcos (salían como segmentos rectos); los bloques con escala desigual, en espejo o repetidos (MINSERT) se importan en su sitio; en SVG, las formas ocultas en <defs> ya no se convierten en piezas, <use> es compatible y un ancho en porcentaje conserva la escala correcta.
- Avisos al importar: la aplicación avisa cuando algunos trazos no se cortarán (entidades fuera de toda pieza, espacio papel, textos y cotas) y cuando los arcos de polilínea se colocan como segmentos rectos.
- Archivos pesados o dañados: la importación es más rápida, y un archivo corrupto se rechaza o se ignora con limpieza en lugar de bloquear la pestaña.
- Espaciado mantenido en las curvas: el espaciado pedido se respeta ahora en las curvas reales del archivo de corte, gracias a un pequeño margen (0,12 mm como máximo) añadido para las piezas con curvas. No cambia nada para las piezas de bordes rectos. Una pieza curva ajustada exactamente a la medida de la chapa puede ser rechazada: el mensaje indica el margen.
- Botón «Reducir el espaciado a X mm»: aplica de verdad X, y no ya la mitad.
- Página del proyecto: las piezas y sus cantidades se muestran primero, el botón de cálculo sigue visible y, tras un cálculo en el servidor, la vista central muestra el resultado.
- Teléfono y tema oscuro: la cabecera y la tabla de planes caben en una pantalla pequeña, y se han corregido los textos ilegibles del tema oscuro.
- Novedades: esta página se muestra ahora en los seis idiomas.
- Archivos por chapa del servidor: se numeran de 1 a N incluso cuando un formato de chapa se queda vacío.

## V0.9.11

*FR*

- Projets : vous pouvez en supprimer plusieurs d'un coup. Dans la liste des projets, « Sélectionner » fait apparaître une case devant chaque projet, sauf le projet de démonstration qui ne se supprime jamais, et « Tout sélectionner » coche tous les projets affichés ; après une seule confirmation, ils sont supprimés un par un et quittent la liste au fur et à mesure. Un projet qui ne peut pas être supprimé (un calcul en cours, par exemple) reste coché avec un message, et la suppression des suivants continue. Pendant une recherche, seuls les projets affichés sont supprimés.
- Connexion : créer un compte avec l'adresse d'un compte Google est refusé avec un message clair et un bouton de connexion Google, au lieu d'une erreur générique. Se connecter avec Google sur l'adresse d'un compte à mot de passe reste refusé, mais un message dit maintenant quoi faire, avec un lien « Mot de passe oublié ? ». Réinitialiser son mot de passe confirme aussi l'adresse e-mail.
- Page de connexion par e-mail : un mauvais mot de passe, un compte déjà existant, un compte suspendu ou trop d'essais affichent maintenant le bon message, au lieu d'une erreur générique.
- Projet : à l'ouverture d'un projet qui contient déjà des fichiers, le message rouge « Sélectionnez au moins un fichier à imbriquer » ne s'affiche plus pendant le chargement.

*EN*

- Projects: you can now delete several at once. In the project list, “Select” shows a checkbox next to each project, except the demo project, which can never be deleted, and “Select all” checks every project shown; after a single confirmation, they are deleted one by one and leave the list as they go. A project that cannot be deleted (a nesting is running, for example) stays selected with a message, and the next ones are still deleted. During a search, only the projects shown are deleted.
- Login: creating an account with the address of a Google account is refused with a clear message and a Google login button, instead of a generic error. Logging in with Google using the address of an account with a password is still refused, but a message now says what to do, with a “Forgot password?” link. Resetting your password also confirms your email address.
- Email login page: a wrong password, an account that already exists, a suspended account or too many attempts now show the right message instead of a generic error.
- Project: when you open a project that already contains files, the red message “Select at least one file to nest” no longer shows while it loads.

*PT*

- Projetos: agora você pode excluir vários de uma vez. Na lista de projetos, “Selecionar” mostra uma caixa de seleção ao lado de cada projeto, exceto o projeto de demonstração, que nunca pode ser excluído, e “Selecionar tudo” marca todos os projetos exibidos; após uma única confirmação, eles são excluídos um a um e saem da lista aos poucos. Um projeto que não pode ser excluído (com um cálculo em andamento, por exemplo) continua marcado com uma mensagem, e a exclusão dos seguintes prossegue. Durante uma busca, só os projetos exibidos são excluídos.
- Login: criar uma conta com o endereço de uma conta Google é recusado com uma mensagem clara e um botão de login com o Google, em vez de um erro genérico. Entrar com o Google usando o endereço de uma conta com senha continua recusado, mas agora uma mensagem diz o que fazer, com um link “Esqueceu a senha?”. Redefinir a senha também confirma o endereço de e-mail.
- Página de login por e-mail: senha incorreta, conta já existente, conta suspensa ou tentativas demais agora mostram a mensagem certa em vez de um erro genérico.
- Projeto: ao abrir um projeto que já contém arquivos, a mensagem vermelha “Selecione pelo menos um arquivo para aninhar” não aparece mais durante o carregamento.

*IT*

- Progetti: ora puoi eliminarne diversi in una volta. Nell'elenco dei progetti, «Seleziona» mostra una casella accanto a ogni progetto, tranne il progetto demo, che non si può mai eliminare, e «Seleziona tutto» spunta tutti i progetti visualizzati; dopo un'unica conferma vengono eliminati uno alla volta e lasciano l'elenco man mano. Un progetto che non si può eliminare (per esempio con un calcolo in corso) resta spuntato con un messaggio, e l'eliminazione dei successivi prosegue. Durante una ricerca vengono eliminati solo i progetti visualizzati.
- Accesso: la creazione di un account con l'indirizzo di un account Google viene rifiutata con un messaggio chiaro e un pulsante di accesso con Google, invece di un errore generico. L'accesso con Google usando l'indirizzo di un account con password continua a essere rifiutato, ma ora un messaggio dice cosa fare, con un link «Password dimenticata?». Reimpostare la password conferma anche l'indirizzo email.
- Pagina di accesso via email: una password errata, un account già esistente, un account sospeso o troppi tentativi mostrano ora il messaggio giusto invece di un errore generico.
- Progetto: all'apertura di un progetto che contiene già dei file, il messaggio rosso «Seleziona almeno un file da annidare» non compare più durante il caricamento.

*DE*

- Projekte: Sie können jetzt mehrere auf einmal löschen. In der Projektliste blendet „Auswählen“ neben jedem Projekt ein Kontrollkästchen ein, außer beim Demo-Projekt, das sich nie löschen lässt, und „Alle auswählen“ wählt alle angezeigten Projekte aus; nach einer einzigen Bestätigung werden sie nacheinander gelöscht und verschwinden nach und nach aus der Liste. Ein Projekt, das nicht gelöscht werden kann (zum Beispiel wegen einer laufenden Berechnung), bleibt mit einer Meldung ausgewählt, und das Löschen der folgenden Projekte geht weiter. Während einer Suche werden nur die angezeigten Projekte gelöscht.
- Anmeldung: Ein Konto mit der Adresse eines Google-Kontos zu erstellen wird mit einer klaren Meldung und einer Schaltfläche für die Google-Anmeldung abgelehnt, statt mit einem allgemeinen Fehler. Die Google-Anmeldung mit der Adresse eines Kontos mit Passwort wird weiterhin abgelehnt, aber eine Meldung sagt jetzt, was zu tun ist, mit dem Link „Passwort vergessen?“. Das Zurücksetzen des Passworts bestätigt auch die E-Mail-Adresse.
- Seite für die E-Mail-Anmeldung: Bei einem falschen Passwort, einem bereits vorhandenen Konto, einem gesperrten Konto oder zu vielen Versuchen erscheint jetzt die richtige Meldung statt eines allgemeinen Fehlers.
- Projekt: Beim Öffnen eines Projekts, das bereits Dateien enthält, erscheint die rote Meldung „Wählen Sie mindestens eine Datei zum Verschachteln aus“ während des Ladens nicht mehr.

*ES*

- Proyectos: ahora puedes eliminar varios de una vez. En la lista de proyectos, «Seleccionar» muestra una casilla junto a cada proyecto, salvo el proyecto de demostración, que nunca se puede eliminar, y «Seleccionar todo» marca todos los proyectos mostrados; tras una sola confirmación, se eliminan uno a uno y van saliendo de la lista. Un proyecto que no se puede eliminar (con un cálculo en curso, por ejemplo) sigue marcado con un mensaje, y la eliminación de los siguientes continúa. Durante una búsqueda, solo se eliminan los proyectos mostrados.
- Acceso: crear una cuenta con la dirección de una cuenta de Google se rechaza con un mensaje claro y un botón para entrar con Google, en lugar de un error genérico. Entrar con Google con la dirección de una cuenta con contraseña sigue rechazándose, pero ahora un mensaje indica qué hacer, con un enlace «¿Has olvidado la contraseña?». Restablecer la contraseña también confirma la dirección de correo electrónico.
- Página de acceso por correo electrónico: una contraseña incorrecta, una cuenta ya existente, una cuenta suspendida o demasiados intentos muestran ahora el mensaje correcto en lugar de un error genérico.
- Proyecto: al abrir un proyecto que ya contiene archivos, el mensaje rojo «Selecciona al menos un archivo para anidar» ya no aparece durante la carga.

## V0.9.10

*FR*

- Offre Free : le calcul n'est plus limité à 2 tôles par tâche. Une tâche s'imbrique sur autant de tôles qu'il le faut et vous voyez tout le résultat ; vous téléchargez les 2 premières tôles de chaque tâche (DXF, ZIP, .job), et Unlimited débloque toutes les tôles (essai gratuit de 7 jours pour un premier abonnement). Avant de lancer un calcul de plus de 2 tôles, l'offre Free vous le rappelle. Après le paiement, vous revenez sur votre projet ; les téléchargements se débloquent dès que le paiement est confirmé, sans recharger la page.
- Pièces qui ne tiennent pas sur les tôles déclarées : le bouton ajoute en une fois le nombre de tôles estimé nécessaire et relance le calcul. Le même bouton apparaît dans la fenêtre du résultat refusé ; depuis l'accueil, « Ouvrir le projet » vous ramène aux réglages.
- Abonnement : un compte dont l'adresse e-mail n'est pas encore confirmée reçoit un message clair au lieu d'ouvrir le paiement ; un premier paiement inabouti propose de mettre à jour le moyen de paiement.

*EN*

- Free plan: nesting is no longer limited to 2 sheets per job. A job nests on as many sheets as it needs and you see the whole result; you download the first 2 sheets of each job (DXF, ZIP, .job), and Unlimited unlocks every sheet (7-day free trial for a first subscription). Before you start a nesting of more than 2 sheets, the Free plan reminds you of this. After payment, you come back to your project; downloads unlock as soon as the payment is confirmed, without reloading the page.
- Parts that do not fit on the declared sheets: the button adds the estimated number of sheets in one go and re-runs the nesting. The same button appears in the window of the refused result; from the home page, “Open the project” takes you back to the settings.
- Subscription: an account whose email address is not yet confirmed now gets a clear message instead of opening the payment; a first payment that did not complete offers to update the payment method.

*PT*

- Plano Free: o cálculo deixa de ser limitado a 2 chapas por trabalho. Um trabalho é aninhado em quantas chapas forem necessárias e você vê o resultado completo; você baixa as 2 primeiras chapas de cada trabalho (DXF, ZIP, .job), e o Unlimited libera todas as chapas (avaliação gratuita de 7 dias para uma primeira assinatura). Antes de iniciar um cálculo com mais de 2 chapas, o plano Free avisa você. Após o pagamento, você volta ao seu projeto; os downloads são liberados assim que o pagamento é confirmado, sem recarregar a página.
- Peças que não cabem nas chapas declaradas: o botão adiciona de uma vez o número de chapas estimado como necessário e reinicia o cálculo. O mesmo botão aparece na janela do resultado recusado; a partir da página inicial, “Abrir o projeto” leva você de volta às configurações.
- Assinatura: uma conta cujo endereço de e-mail ainda não foi confirmado recebe agora uma mensagem clara em vez de abrir o pagamento; um primeiro pagamento não concluído propõe atualizar a forma de pagamento.

*IT*

- Piano Free: il calcolo non è più limitato a 2 lamiere per lavoro. Un lavoro viene annidato su tutte le lamiere necessarie e vedi l'intero risultato; scarichi le prime 2 lamiere di ogni lavoro (DXF, ZIP, .job), e Unlimited sblocca tutte le lamiere (prova gratuita di 7 giorni per un primo abbonamento). Prima di avviare un calcolo di oltre 2 lamiere, il piano Free te lo ricorda. Dopo il pagamento torni al tuo progetto; i download si sbloccano non appena il pagamento è confermato, senza ricaricare la pagina.
- Pezzi che non stanno sulle lamiere dichiarate: il pulsante aggiunge in una volta il numero di lamiere stimato necessario e rilancia il calcolo. Lo stesso pulsante compare nella finestra del risultato rifiutato; dalla pagina iniziale, «Apri il progetto» ti riporta alle impostazioni.
- Abbonamento: un account il cui indirizzo email non è ancora confermato riceve ora un messaggio chiaro invece di aprire il pagamento; un primo pagamento non andato a buon fine propone di aggiornare il metodo di pagamento.

*DE*

- Free-Plan: Die Berechnung ist nicht mehr auf 2 Bleche pro Auftrag begrenzt. Ein Auftrag wird auf so vielen Blechen verschachtelt, wie nötig, und Sie sehen das gesamte Ergebnis; Sie laden die ersten 2 Bleche jedes Auftrags herunter (DXF, ZIP, .job), und Unlimited schaltet alle Bleche frei (kostenlose 7-Tage-Testphase bei einem ersten Abonnement). Bevor Sie eine Berechnung mit mehr als 2 Blechen starten, weist der Free-Plan Sie darauf hin. Nach der Zahlung kehren Sie zu Ihrem Projekt zurück; die Downloads werden freigeschaltet, sobald die Zahlung bestätigt ist, ohne die Seite neu zu laden.
- Teile, die nicht auf die angegebenen Bleche passen: Die Schaltfläche fügt auf einmal die geschätzt benötigte Anzahl Bleche hinzu und startet die Berechnung neu. Dieselbe Schaltfläche erscheint im Fenster des abgelehnten Ergebnisses; von der Startseite führt „Projekt öffnen“ Sie zu den Einstellungen zurück.
- Abonnement: Ein Konto, dessen E-Mail-Adresse noch nicht bestätigt ist, erhält jetzt eine klare Meldung, statt die Zahlung zu öffnen; eine nicht abgeschlossene erste Zahlung bietet an, die Zahlungsmethode zu aktualisieren.

*ES*

- Plan Free: el cálculo ya no está limitado a 2 chapas por trabajo. Un trabajo se anida en tantas chapas como haga falta y ves todo el resultado; descargas las 2 primeras chapas de cada trabajo (DXF, ZIP, .job), y Unlimited desbloquea todas las chapas (prueba gratuita de 7 días para una primera suscripción). Antes de lanzar un cálculo de más de 2 chapas, el plan Free te lo recuerda. Tras el pago vuelves a tu proyecto; las descargas se desbloquean en cuanto se confirma el pago, sin recargar la página.
- Piezas que no caben en las chapas declaradas: el botón añade de una vez el número de chapas estimado como necesario y vuelve a lanzar el cálculo. El mismo botón aparece en la ventana del resultado rechazado; desde la página de inicio, «Abrir el proyecto» te devuelve a los ajustes.
- Suscripción: una cuenta cuya dirección de correo electrónico aún no está confirmada recibe ahora un mensaje claro en lugar de abrir el pago; un primer pago no completado propone actualizar el método de pago.

## V0.9.9

*FR*

- Import : quand un fichier DWG ne peut pas être importé, la fiche du fichier en donne désormais la raison (version d'AutoCAD trop récente, fichier illisible, conversion trop longue…) et la marche à suivre, au lieu d'un simple « Échec de l'import ».
- Résultats : après 24 heures, un résultat calculé sur nos serveurs s'affiche bien comme expiré, sans boutons de téléchargement qui ne mènent plus à rien. Télécharger les tôles d'un gros résultat une à une ne bloque plus au bout d'une trentaine de fichiers, et une archive ZIP n'est plus jamais livrée incomplète : en cas de problème, le téléchargement échoue clairement.
- Fichiers .job SheetCam : la vue agrandie occupe toute la hauteur de l'écran.
- Abonnement : après une résiliation, la date de fin de l'abonnement s'affiche correctement.
- Sécurité et vie privée : vous restez connecté tant que vous utilisez l'application ; une session inutilisée pendant 90 jours expire. La suppression d'un compte efface désormais toutes ses données, y compris l'inscription à la newsletter, et les journaux techniques ne contiennent plus aucune adresse e-mail.

*EN*

- When a DWG file cannot be imported, its file card now gives the reason (AutoCAD version too recent, unreadable file, conversion taking too long…) and what to do next, instead of a simple "Import failed".
- Results: after 24 hours, a result calculated on our servers now correctly shows as expired, with no download buttons leading nowhere. Downloading the sheets of a large result one by one no longer stalls after about thirty files, and a ZIP archive is never delivered incomplete any more: if something goes wrong, the download fails clearly.
- SheetCam .job files: the enlarged view now fills the full height of the screen.
- Subscription: after a cancellation, the subscription end date is now displayed correctly.
- Security and privacy: you stay signed in as long as you use the application; a session unused for 90 days expires. Deleting an account now erases all its data, including its newsletter subscription, and technical logs no longer contain any email address.

*PT*

- Quando um arquivo DWG não pode ser importado, a ficha do arquivo agora informa o motivo (versão do AutoCAD muito recente, arquivo ilegível, conversão demorada demais…) e o que fazer, em vez de apenas "Falha na importação".
- Resultados: após 24 horas, um resultado calculado em nossos servidores agora aparece corretamente como expirado, sem botões de download que não levam a lugar nenhum. Baixar as chapas de um resultado grande uma a uma não trava mais após cerca de trinta arquivos, e um arquivo ZIP nunca mais é entregue incompleto: se algo der errado, o download falha de forma clara.
- Arquivos .job do SheetCam: a visualização ampliada ocupa toda a altura da tela.
- Assinatura: após um cancelamento, a data de término da assinatura agora é exibida corretamente.
- Segurança e privacidade: você permanece conectado enquanto usa o aplicativo; uma sessão sem uso por 90 dias expira. A exclusão de uma conta agora apaga todos os seus dados, inclusive a inscrição na newsletter, e os registros técnicos não contêm mais nenhum endereço de e-mail.

*IT*

- Quando un file DWG non può essere importato, la sua scheda ora indica il motivo (versione di AutoCAD troppo recente, file illeggibile, conversione troppo lunga…) e come procedere, invece di un semplice «Importazione non riuscita».
- Risultati: dopo 24 ore, un risultato calcolato sui nostri server viene correttamente mostrato come scaduto, senza pulsanti di download che non portano più da nessuna parte. Scaricare le lamiere di un risultato grande una per una non si blocca più dopo una trentina di file, e un archivio ZIP non viene più consegnato incompleto: in caso di problema, il download fallisce in modo chiaro.
- File .job di SheetCam: la vista ingrandita occupa tutta l'altezza dello schermo.
- Abbonamento: dopo una disdetta, la data di fine dell'abbonamento ora viene mostrata correttamente.
- Sicurezza e privacy: resti connesso finché usi l'applicazione; una sessione inutilizzata per 90 giorni scade. L'eliminazione di un account ora cancella tutti i suoi dati, compresa l'iscrizione alla newsletter, e i log tecnici non contengono più alcun indirizzo email.

*DE*

- Wenn eine DWG-Datei nicht importiert werden kann, nennt ihre Dateikarte jetzt den Grund (AutoCAD-Version zu neu, Datei nicht lesbar, Konvertierung dauert zu lange …) und das weitere Vorgehen, statt nur „Import fehlgeschlagen“ anzuzeigen.
- Ergebnisse: Nach 24 Stunden wird ein auf unseren Servern berechnetes Ergebnis jetzt korrekt als abgelaufen angezeigt, ohne Download-Schaltflächen, die nirgendwohin mehr führen. Das einzelne Herunterladen der Bleche eines großen Ergebnisses bleibt nicht mehr nach etwa dreißig Dateien hängen, und ein ZIP-Archiv wird nie mehr unvollständig geliefert: Tritt ein Problem auf, bricht der Download klar sichtbar ab.
- SheetCam-.job-Dateien: Die vergrößerte Ansicht nutzt die gesamte Bildschirmhöhe.
- Abonnement: Nach einer Kündigung wird das Enddatum des Abonnements jetzt korrekt angezeigt.
- Sicherheit und Datenschutz: Sie bleiben angemeldet, solange Sie die Anwendung nutzen; eine 90 Tage lang ungenutzte Sitzung läuft ab. Das Löschen eines Kontos entfernt jetzt alle seine Daten, einschließlich der Newsletter-Anmeldung, und die technischen Protokolle enthalten keine E-Mail-Adresse mehr.

*ES*

- Cuando un archivo DWG no se puede importar, su ficha ahora indica el motivo (versión de AutoCAD demasiado reciente, archivo ilegible, conversión demasiado larga…) y qué hacer, en lugar de un simple «Error al importar».
- Resultados: tras 24 horas, un resultado calculado en nuestros servidores ahora aparece correctamente como caducado, sin botones de descarga que ya no lleven a ninguna parte. Descargar las chapas de un resultado grande una a una ya no se bloquea tras unos treinta archivos, y un archivo ZIP ya nunca llega incompleto: si algo falla, la descarga se interrumpe de forma clara.
- Archivos .job de SheetCam: la vista ampliada ocupa toda la altura de la pantalla.
- Suscripción: tras una cancelación, la fecha de fin de la suscripción ahora se muestra correctamente.
- Seguridad y privacidad: sigues conectado mientras uses la aplicación; una sesión sin uso durante 90 días caduca. Al eliminar una cuenta se borran ahora todos sus datos, incluida la suscripción al newsletter, y los registros técnicos ya no contienen ninguna dirección de correo electrónico.

## V0.9.8

*FR*

- Le menu de l'application parle votre langue : les liens Fonctionnalités, Comment ça marche et FAQ pointent vers le site dans votre langue, un lien Documentation apparaît dans le menu et à côté d'Espace, et l'en-tête occupe toute la largeur de l'écran et s'adapte à la place disponible — menu complet quand tout tient, menu replié sinon — jamais un libellé coupé ni hors de l'écran. La promesse de notifications par e-mail est retirée (elle n'a jamais fonctionné), ainsi que les crédits et la mention « layouts plus denses » du plan Pro : Pro livre le même résultat plus tôt, pas un autre.
- Sécurité : les journaux techniques de l'application ne conservent plus le contenu des échanges et sont effacés au bout de 14 jours.
- Facturation : les abonnés gèrent leur facturation (carte de paiement, factures, résiliation) depuis leur profil ; un problème de paiement est désormais signalé clairement, avec un bouton pour mettre à jour la carte. L'essai gratuit de 7 jours n'est proposé qu'une fois par compte. Le passage de Unlimited à Pro modifie désormais l'abonnement en cours au lieu d'en créer un second.
- Échecs : lorsqu'un calcul échoue, la carte de résultat indique désormais la raison. Un calcul interrompu dans le navigateur ne laisse plus la tâche bloquée : il est clos et le calcul est remboursé.
- Mentions légales : pages légales corrigées — hébergeur (Hetzner, Allemagne, derrière Cloudflare), licence du code (PolyForm Noncommercial ; les parties héritées de nest2d restent sous MIT), liste des sous-traitants, date de révision fixée, packs de crédits retirés.

*EN*

- The app menu now speaks your language: the Features, How It Works and FAQ links point to the site in your language, a Documentation link appears in the menu and next to Workspace, and the header spans the full width of the screen and adapts to the available space — full menu when everything fits, collapsed menu otherwise — never a label wrapped or off-screen. The email notification promise is removed (it never worked), along with credits and the Pro "denser layouts" claim: Pro delivers the same result sooner, not a different one.
- The application's technical logs no longer keep the content of exchanges and are erased after 14 days.
- Subscribers can manage their billing (payment card, invoices, cancellation) from their profile; a payment problem is now clearly shown with a button to update the card. The 7-day free trial is offered once per account. Upgrading from Unlimited to Pro now changes the current subscription instead of creating a second one.
- When a nesting fails, the result card now says why. A computation interrupted in the browser no longer leaves the job stuck: it is closed and the nesting is refunded.
- Legal pages corrected: hosting provider (Hetzner, Germany, behind Cloudflare), code licence (PolyForm Noncommercial; parts inherited from nest2d remain MIT), list of sub-processors, fixed revision date, credit packs removed.

*PT*

- O menu da aplicação agora fala seu idioma: os links Recursos, Como funciona e FAQ apontam para o site no seu idioma, um link Documentação aparece no menu e ao lado de Meu espaço, e o cabeçalho ocupa toda a largura da tela e se adapta ao espaço disponível — menu completo quando tudo cabe, menu recolhido caso contrário — nunca um rótulo quebrado ou fora da tela. A promessa de notificações por e-mail foi retirada (nunca funcionou), junto com os créditos e a menção "arranjos mais densos" do Pro: o Pro entrega o mesmo resultado mais cedo, não outro.
- Os registros técnicos da aplicação não guardam mais o conteúdo das trocas e são apagados após 14 dias.
- Os assinantes podem gerenciar a cobrança (cartão de pagamento, faturas, cancelamento) pelo perfil; um problema de pagamento agora aparece com clareza, com um botão para atualizar o cartão. O teste gratuito de 7 dias é oferecido uma única vez por conta. Migrar do Unlimited para o Pro agora altera a assinatura atual em vez de criar uma segunda.
- Quando um cálculo falha, o cartão de resultado agora informa o motivo. Um cálculo interrompido no navegador não deixa mais a tarefa travada: ela é encerrada e o cálculo é reembolsado.
- Páginas legais corrigidas: provedor de hospedagem (Hetzner, Alemanha, atrás da Cloudflare), licença do código (PolyForm Noncommercial; partes herdadas do nest2d continuam sob MIT), lista de subprocessadores, data de revisão fixada, pacotes de créditos removidos.

*IT*

- Il menu dell'applicazione ora parla la tua lingua: i link Funzioni, Come funziona e FAQ puntano al sito nella tua lingua, un link Documentazione appare nel menu e accanto a Area di lavoro, e l'intestazione occupa tutta la larghezza dello schermo e si adatta allo spazio disponibile — menu completo quando tutto sta, menu richiuso altrimenti — mai un'etichetta spezzata o fuori dallo schermo. La promessa di notifiche via email è stata ritirata (non ha mai funzionato), insieme ai crediti e alla menzione "disposizioni più dense" del Pro: il Pro consegna lo stesso risultato prima, non un altro.
- I log tecnici dell'applicazione non conservano più il contenuto degli scambi e vengono cancellati dopo 14 giorni.
- Gli abbonati possono gestire la fatturazione (carta di pagamento, fatture, disdetta) dal proprio profilo; un problema di pagamento è ora segnalato chiaramente, con un pulsante per aggiornare la carta. La prova gratuita di 7 giorni è offerta una sola volta per account. Il passaggio da Unlimited a Pro ora modifica l'abbonamento in corso invece di crearne un secondo.
- Quando un calcolo fallisce, la scheda del risultato ora spiega il motivo. Un calcolo interrotto nel browser non lascia più il lavoro bloccato: viene chiuso e il calcolo viene rimborsato.
- Pagine legali corrette: fornitore di hosting (Hetzner, Germania, dietro Cloudflare), licenza del codice (PolyForm Noncommercial; le parti ereditate da nest2d restano MIT), elenco dei sub-responsabili, data di revisione fissata, pacchetti di crediti rimossi.

*DE*

- Das Anwendungsmenü spricht jetzt Ihre Sprache: die Links Funktionen, So funktioniert es und FAQ zeigen auf die Website in Ihrer Sprache, ein Dokumentations-Link erscheint im Menü und neben Arbeitsbereich, und die Kopfzeile nutzt die gesamte Bildschirmbreite und passt sich dem verfügbaren Platz an — volles Menü, wenn alles hineinpasst, sonst eingeklapptes Menü — nie eine Beschriftung umbrochen oder außerhalb des Bildschirms. Die E-Mail-Benachrichtigungs-Zusage wurde zurückgezogen (sie funktionierte nie), ebenso wie Credits und die "dichteren Layouts"-Aussage von Pro: Pro liefert dasselbe Ergebnis früher, kein anderes.
- Die technischen Protokolle der Anwendung speichern keine Inhalte von Übertragungen mehr und werden nach 14 Tagen gelöscht.
- Abonnenten können ihre Abrechnung (Zahlungskarte, Rechnungen, Kündigung) über ihr Profil verwalten; ein Zahlungsproblem wird jetzt deutlich angezeigt, mit einer Schaltfläche zum Aktualisieren der Karte. Die 7-tägige kostenlose Testphase wird pro Konto nur einmal angeboten. Der Wechsel von Unlimited zu Pro ändert jetzt das laufende Abonnement, statt ein zweites zu erstellen.
- Wenn eine Berechnung fehlschlägt, nennt die Ergebniskarte jetzt den Grund. Eine im Browser unterbrochene Berechnung bleibt nicht mehr hängen: Sie wird abgeschlossen und die Berechnung wird erstattet.
- Rechtliche Seiten korrigiert: Hosting-Anbieter (Hetzner, Deutschland, hinter Cloudflare), Lizenz des Codes (PolyForm Noncommercial; von nest2d übernommene Teile bleiben MIT), Liste der Unterauftragsverarbeiter, festes Revisionsdatum, Credit-Pakete entfernt.

*ES*

- El menú de la aplicación ahora habla tu idioma: los enlaces Funciones, Cómo funciona y FAQ apuntan al sitio en tu idioma, un enlace Documentación aparece en el menú y junto a Área de trabajo, y la cabecera ocupa todo el ancho de la pantalla y se adapta al espacio disponible — menú completo cuando todo cabe, menú plegado en caso contrario — nunca una etiqueta cortada ni fuera de la pantalla. La promesa de notificaciones por correo electrónico fue retirada (nunca funcionó), junto con los créditos y la mención "disposiciones más densas" de Pro: Pro entrega el mismo resultado antes, no otro.
- Los registros técnicos de la aplicación ya no guardan el contenido de los intercambios y se borran tras 14 días.
- Los suscriptores pueden gestionar su facturación (tarjeta de pago, facturas, cancelación) desde su perfil; un problema de pago se muestra ahora claramente, con un botón para actualizar la tarjeta. La prueba gratuita de 7 días se ofrece una sola vez por cuenta. Pasar de Unlimited a Pro ahora cambia la suscripción actual en lugar de crear una segunda.
- Cuando un cálculo falla, la tarjeta de resultado ahora indica el motivo. Un cálculo interrumpido en el navegador ya no deja la tarea bloqueada: se cierra y el cálculo se reembolsa.
- Páginas legales corregidas: proveedor de alojamiento (Hetzner, Alemania, detrás de Cloudflare), licencia del código (PolyForm Noncommercial; las partes heredadas de nest2d siguen bajo MIT), lista de subencargados, fecha de revisión fijada, paquetes de créditos eliminados.

## V0.9.7

*FR*

- L'onglet et le pied de page parlent la langue choisie : le titre du navigateur suit l'anglais, le français, le portugais, l'italien, l'allemand ou l'espagnol, et les liens du pied de page sont traduits (les pages légales restent en français et en anglais). Le portugais est déclaré brésilien comme sur le site.

*EN*

- The browser tab and the public footer now speak the chosen language: the page title follows English, French, Portuguese, Italian, German or Spanish, and the footer links are translated (the legal pages stay in French and English). Portuguese is declared Brazilian, matching the website.

*PT*

- A aba do navegador e o rodapé público agora falam o idioma escolhido: o título da página segue inglês, francês, português, italiano, alemão ou espanhol, e os links do rodapé estão traduzidos (as páginas legais continuam em francês e inglês). O português é declarado brasileiro, como no site.

*IT*

- La scheda del browser e il piè di pagina pubblico ora parlano la lingua scelta: il titolo della pagina segue inglese, francese, portoghese, italiano, tedesco o spagnolo, e i link del piè di pagina sono tradotti (le pagine legali restano in francese e inglese). Il portoghese è dichiarato brasiliano, come sul sito.

*DE*

- Der Browser-Tab und die öffentliche Fußzeile sprechen jetzt die gewählte Sprache: der Seitentitel folgt Englisch, Französisch, Portugiesisch, Italienisch, Deutsch oder Spanisch, und die Fußzeilen-Links sind übersetzt (die Rechtsseiten bleiben Französisch und Englisch). Portugiesisch wird als brasilianisch deklariert, wie auf der Website.

*ES*

- La pestaña del navegador y el pie de página público ahora hablan el idioma elegido: el título de la página sigue inglés, francés, portugués, italiano, alemán o español, y los enlaces del pie de página están traducidos (las páginas legales siguen en francés e inglés). El portugués se declara brasileño, como en el sitio.

## V0.9.6

*FR*

- NestorCut parle espagnol : interface, site et documentation entièrement
  traduits. La langue de votre navigateur est reconnue dès la première
  visite, et le menu de langues offre Español à côté de English, Français,
  Português, Deutsch et Italiano. Au passage, les dates suivent la langue
  de l'application partout — un utilisateur portugais, italien ou allemand
  lisait des dates anglaises.

*EN*

- NestorCut now speaks Spanish: interface, website and documentation
  fully translated. Your browser language is detected on your first
  visit, and the language menu offers Español alongside English,
  Français, Português, Deutsch and Italiano. Along the way, dates now
  follow the app language everywhere — Portuguese, Italian and German
  users were reading English dates.

*PT*

- O NestorCut agora fala espanhol: interface, site e documentação
  totalmente traduzidos. O idioma do seu navegador é detectado na
  primeira visita, e o menu de idiomas oferece Español junto de
  English, Français, Português, Deutsch e Italiano. De passagem, as
  datas seguem o idioma do aplicativo em todos os lugares — um usuário
  português, italiano ou alemão lia datas em inglês.

*IT*

- NestorCut ora parla spagnolo: interfaccia, sito e documentazione
  completamente tradotti. La lingua del tuo browser viene riconosciuta
  dalla prima visita, e il menu delle lingue offre Español accanto a
  English, Français, Português, Deutsch e Italiano. Al passaggio, le
  date seguono la lingua dell'app ovunque — un utente portoghese,
  italiano o tedesco leggeva date in inglese.

*DE*

- NestorCut spricht jetzt Spanisch: Oberfläche, Website und
  Dokumentation vollständig übersetzt. Die Sprache Ihres Browsers wird
  beim ersten Besuch erkannt, und das Sprachmenü bietet Español neben
  English, Français, Português, Deutsch und Italiano. Nebenbei folgen
  die Datierungen jetzt überall der App-Sprache — ein portugiesischer,
  italienischer oder deutscher Benutzer las englische Datierungen.

*ES*

- NestorCut habla español: interfaz, sitio y documentación totalmente
  traducidos. El idioma de tu navegador se detecta en la primera
  visita, y el menú de idiomas ofrece Español junto a English,
  Français, Português, Deutsch e Italiano. De paso, las fechas siguen
  el idioma de la aplicación en todas partes — un usuario portugués,
  italiano o alemán leía fechas en inglés.

## V0.9.5

*FR*

- NestorCut parle allemand : interface, site et documentation entièrement
  traduits. La langue de votre navigateur est reconnue dès la première
  visite, et le menu de langues offre Deutsch à côté de English,
  Français, Português et Italiano. Au passage, les balises de langue du
  site sont harmonisées et la page d'accueil de chaque langue désigne
  l'anglais comme référence.

*EN*

- NestorCut now speaks German: interface, website and documentation
  fully translated. Your browser language is detected on your first
  visit, and the language menu offers Deutsch alongside English,
  Français, Português and Italiano. Along the way, the site's language
  tags are harmonized and every language's home page now points to
  English as the default.

*PT*

- O NestorCut agora fala alemão: interface, site e documentação
  totalmente traduzidos. O idioma do seu navegador é detectado na
  primeira visita, e o menu de idiomas oferece Deutsch junto de
  English, Français, Português e Italiano. De passagem, as balizas de
  idioma do site foram harmonizadas e a página inicial de cada idioma
  aponta o inglês como referência.

*IT*

- NestorCut ora parla tedesco: interfaccia, sito e documentazione
  completamente tradotti. La lingua del tuo browser viene riconosciuta
  dalla prima visita, e il menu delle lingue offre Deutsch accanto a
  English, Français, Português e Italiano. Al passaggio, i tag lingua
  del sito sono stati armonizzati e la home di ogni lingua indica
  l'inglese come riferimento.

*DE*

- NestorCut spricht jetzt Deutsch: Oberfläche, Website und
  Dokumentation vollständig übersetzt. Die Sprache Ihres Browsers wird
  beim ersten Besuch erkannt, und das Sprachmenü bietet Deutsch neben
  English, Français, Português und Italiano. Nebenbei sind die
  Sprach-Tags der Website harmonisiert, und die Startseite jeder
  Sprache nennt das Englische als Referenz.

## V0.9.4

*FR*

- NestorCut parle italien : interface, site et documentation entièrement
  traduits. La langue de votre navigateur est reconnue dès la première
  visite, et le menu de langues offre Italiano à côté de English,
  Français et Português. Au passage, les longueurs suivent la langue :
  un utilisateur français lit désormais « 1040,4 mm » avec sa virgule.

*EN*

- NestorCut now speaks Italian: interface, website and documentation
  fully translated. Your browser language is detected on your first
  visit, and the language menu offers Italiano alongside English,
  Français and Português. Along the way, lengths now follow the
  language: a French user now reads "1040,4 mm" with the proper comma.

*PT*

- O NestorCut agora fala italiano: interface, site e documentação
  totalmente traduzidos. O idioma do seu navegador é detectado na
  primeira visita, e o menu de idiomas oferece Italiano junto de
  English, Français e Português. De passagem, os comprimentos seguem o
  idioma: um usuário francês agora lê « 1040,4 mm » com sua vírgula.

*IT*

- NestorCut ora parla italiano: interfaccia, sito e documentazione
  completamente tradotti. La lingua del tuo browser viene riconosciuta
  dalla prima visita, e il menu delle lingue offre Italiano accanto a
  English, Français e Português. Al passaggio, le lunghezze seguono la
  lingua: un utente francese ora legge « 1040,4 mm » con la sua virgola.

## V0.9.3

*FR*

- NestorCut parle portugais du Brésil : interface, site et
  documentation entièrement traduits. La langue de votre navigateur est
  reconnue dès la première visite, et le menu de langues offre
  Português à côté de English et Français.

*EN*

- NestorCut now speaks Brazilian Portuguese: interface, website and
  documentation fully translated. Your browser language is detected on
  your first visit, and the language menu offers Português alongside
  English and French.

*PT*

- O NestorCut agora fala português do Brasil: interface, site e
  documentação totalmente traduzidos. O idioma do seu navegador é
  detectado na primeira visita, e o menu de idiomas oferece Português
  junto de English e Français.

## V0.9.2

*FR*

- Un « ? » près de chaque réglage et du résultat ouvre le guide au bon
  endroit, dans votre langue : tôles, espacement, rotations, sens,
  options, propositions, chute, badges, téléchargements.

*EN*

- A “?” next to each setting and on the result opens the guide at the
  right place, in your language: sheets, spacing, rotations,
  directions, options, proposals, offcut, badges, downloads.

## V0.9.1

*FR*

- La langue de votre navigateur est reconnue dès la première visite : la
  page arrive dans votre langue, sans éclair ni réglage préalable. Le
  bouton EN/FR devient un menu de langues — chaque langue y porte son
  propre nom.

*EN*

- Your browser language is recognized on your very first visit: the page
  arrives in your language, with no flash and no prior setting. The
  EN/FR button becomes a language menu — each language shown under its
  own name.

## V0.9

*FR*

- Vous déposez un fichier de travail SheetCam (`.job`) seul, sans ses DXF :
  la géométrie, la tôle, le kerf, les quantités et vos points de départ
  sont lus dans le fichier, et le nesting rend **un `.job` par tôle**
  prêt à rouvrir dans SheetCam. Le bouton de téléchargement `.job` est
  devenu l'action principale du résultat.
- Un dessin présent plusieurs fois dans un même `.job` (par exemple
  quatre exemplaires) donne **quatre pièces libres**, regroupées sous une
  seule carte dépliable — chacune garde le point de départ que vous avez
  placé, à l'octet près.
- Les amorces d'entrée et de sortie se voient **avant** le calcul (aperçu
  de la fiche, vue agrandie) et **pendant** (vue en direct), avec le
  point de perçage ; la place gardée pour l'amorce est exactement celle
  que vous voyez.
- Déposez tous vos fichiers d'un coup — même plus de vingt : l'envoi
  se fait par lots automatiques, et un fichier refusé est toujours nommé.
- Une pièce seule sur une grande tôle se neste désormais (elle passait
  en erreur si elle était petite devant la tôle).

*EN*

- Drop a SheetCam job file (`.job`) on its own, without its DXFs: the
  geometry, the sheet, the kerf, the quantities and your start points are
  read from the file, and nesting returns **one `.job` per sheet** ready
  to reopen in SheetCam. The `.job` download is now the primary action.
- A drawing placed several times in the same `.job` (four copies, say)
  yields **four free parts** grouped under one expandable card — each
  keeps the start point you placed, byte for byte.
- Lead-in and lead-out paths are visible **before** the run (card
  preview, enlarged view) and **during** it (live view), with the pierce
  point; the room kept for the lead is exactly what you see.
- Drop all your files at once — even more than twenty: uploads are sent
  in automatic batches, and a rejected file is always named.
- A single small part on a large sheet now nests (it used to fail when
  tiny compared to the sheet).
