# Journal de NestorCut

Une entrée par version mise en production. En langage d'atelier — jamais de
noms de lots internes. La version affichée dans l'en-tête est le
`MAJEUR.MINEUR` ; ici et dans le pied de page, le numéro complet.

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
