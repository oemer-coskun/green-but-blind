# green-but-blind

Vier Kommandozeilen-Werkzeuge, die Tests finden, die grün sind ohne etwas zu
messen — und Steuerzeichen, die Code unsichtbar kaputt machen.

*English version: [README.md](README.md)*

---

## Warum es sie gibt

Ich habe in einem Projekt von mir geprüft, ob die Wächter tatsächlich Wächter
sind. Nicht, ob die Tests grün sind — das waren sie alle — sondern ob auch nur
einer von ihnen merken würde, wenn das, was er zu schützen behauptet, still
kaputtgeht.

Mehrere hätten es nicht gemerkt.

Der deutlichste Fall war ein Test, der ein Ledger auf eine Sorte von Ereignis
filterte und dann etwas über das Gefundene zusicherte. Der Filter war falsch. Die
Produktion schrieb nie Ereignisse unter diesem Namen, der Filter traf also nichts,
die Zusicherung verglich die leere Menge mit der leeren Menge. Er war grün. Er war
immer grün gewesen. Er wäre für immer grün geblieben, egal was der Code darunter
tut.

Das war kein schwacher Test. Das war überhaupt kein Test. Und nichts in meiner
Werkzeugkette konnte mir das sagen: er lief, er war grün, er tauchte sogar in der
Abdeckung auf — denn er *führte* den Produktionscode aus, er sicherte nur nie
etwas über das Ergebnis zu.

Um diese Form geht es hier. Nicht um Tests, die fallen, und nicht um Tests, die
fehlen. Um Tests, die **da sind, grün sind und blind sind**.

> **Zur Geschichte oben:** Ich kann diese Codebasis nicht zeigen, also nimm sie
> bitte als das, was sie ist — eine Erzählung. Alles ab hier ist in diesem Repo
> nachprüfbar, und zu jeder Zahl steht der Befehl, der sie erzeugt. Diese
> Asymmetrie ist Absicht: ein Repo über unbelegte Behauptungen sollte nicht mit
> einer anfangen.

## Die zwei Regeln, die daraus wurden

**1. Ein Wächter gilt erst als wirksam, wenn man ihn einmal feuern gesehen hat.**

Wächter schreiben, dann absichtlich kaputt machen, was er schützt, und
nachsehen, ob die Suite rot wird. Einmal. Bevor man ihm traut. Das kostet eine
Minute und ist der einzige Beleg dafür, dass der Wächter überhaupt mit etwas
verbunden ist. `mutation-proof` ist diese Minute, automatisiert.

**2. Rot ist kein Nachweis, solange nicht geprüft ist, *welche* Zusicherung
gegriffen hat.**

Ein Lauf kann aus einem Grund rot werden, der mit dem eigenen Wächter nichts zu
tun hat — eine andere Zusicherung, früher im selben Test, greift zuerst. „Die
Suite wurde rot" und „mein Wächter hat gefeuert" sind zwei verschiedene
Behauptungen, und nur eine davon ist ein Beleg.

Für genau diesen Fehler gibt es hier ein lebendes Beispiel. Beim Schreiben der
Grundlinie für das Steuerzeichen-Gate habe ich behauptet, zwei namentlich
genannte Tests würden fallen, wenn man eine Konstante leert. Ich habe es
gemessen. Es fielen zwei Tests — **und einer davon war nicht der, den ich genannt
hatte.** Die Anzahl stimmte, die Identität nicht. Die berichtigte Begründung
steht in `control-chars.baseline.json`, und die Messung lässt sich mit einem
Befehl wiederholen.

## Eine Regel, die diese Werkzeuge einhalten

Drei der vier melden **Befunde**. Das vierte fällt ein **Urteil**, und es darf
genau zwei:

```
FIRED     ein Test wurde rot, während der Code mutiert war
UNCLEAR   dieses Werkzeug konnte nicht sehen, was passiert ist
```

Ein drittes Urteil gibt es nicht. Insbesondere gibt es kein „feuert nicht", denn
das Werkzeug kann *„kein Test fiel"* nicht von *„ich konnte die Ausgabe nicht
lesen"* unterscheiden — und eine behauptete Abwesenheit ist der gefährlichere
Fehler. Ein fehlender Wächter meldet sich irgendwann selbst, weil ein Defekt
durchkommt. Ein fälschlich als fehlend gemeldeter tut das nie: alles läuft
weiter, und man hält einfach eine falsche Landkarte des eigenen Systems in der
Hand, mit voller Überzeugung.

Eine frühere Fassung dieses Werkzeugs hat Abwesenheiten gemeldet. Sie nannte drei
vorhandene Wächter fehlend, weil sie die farbige Ausgabe des Testläufers nicht
lesen konnte. Alle drei waren in Ordnung. Die Erkennung ist inzwischen repariert —
sie liest TAP und vitest-JSON statt Text abzuschöpfen — aber die Regel blieb, denn
*richtig* ist nicht *allwissend*.

## Die vier Werkzeuge

Jedes läuft eigenständig, jedes hat `--help`, und jedes nennt seine Grenzen im
Dateikopf statt in einer Fußnote.

| | findet | ist nicht |
|---|---|---|
| **`mutation-proof`** | Wächter, die nicht feuern — indem es den Code absichtlich bricht | ein vollwertiges Mutationstest-Rahmenwerk |
| **`dead-filters`** | Zusicherungen, die auf ein Ereignis filtern, das niemand schreibt | ein Parser — es sucht String-Literale |
| **`second-lists`** | dieselben Strings zweimal geschrieben, einmal als Typ, einmal als Wert | ein Parser — nur einzeilige Unions |
| **`control-chars`** | rohe Steuer- und Nullbreiten-Zeichen im Quelltext | eine Prüfung auf *falsche Escapes* — die bleiben unsichtbar |

Drei davon sind **Werkzeuge**, eines ist ein **Gate**, und der Unterschied ist
Absicht.

Ein Gate muss vollständig sein, ein Werkzeug muss ehrlich sein. `dead-filters`
und `second-lists` arbeiten beide über Textsuche, haben also bauartbedingt blinde
Flecken — als Gate würden sie grün melden, ohne gemessen zu haben, und das ist
exakt der Defekt, für dessen Auffinden es dieses Repo gibt. Deshalb bringen sie
nie einen Build zu Fall. Sie drucken Befunde, sie beenden mit 0, und ihre Köpfe
sagen, was sie übersehen.

`control-chars` ist ein Gate, weil es eines sein kann: es liest Code-Punkte und
vergleicht sie gegen eine geschlossene Menge. Kein Raten, nichts, woran das Parsen
scheitern könnte.

## Ausprobieren, ohne eigene Codebasis

Unter `fixtures/example-project` liegt ein kleines Beispielprojekt mit je einem
gepflanzten Defekt pro Werkzeug. **Alle neun seiner Tests sind grün** — das ist
der Punkt.

```bash
git clone https://github.com/oemer-coskun/green-but-blind
cd green-but-blind

node --test "fixtures/example-project/src/*.test.js"   # 9 Tests, 9 grün
```

Und jetzt den Defekt suchen, den diese grüne Suite verdeckt:

```bash
node bin/dead-filters.mjs   --root fixtures/example-project/src
node bin/second-lists.mjs   --root fixtures/example-project/src
node bin/control-chars.mjs  --report --root fixtures/example-project
node bin/mutation-proof.mjs --spec  fixtures/example-project/mutations.json
```

Was die vier ausgeben sollen — und welche der Treffer *keine* Defekte sind —
steht Schritt für Schritt in
[`fixtures/example-project/README.md`](fixtures/example-project/README.md).

Kurzfassung: `mutation-proof` meldet **3 FIRED, 2 UNCLEAR**. Eines dieser
UNCLEAR-Ergebnisse löscht ein Feld aus einem Ereignis — während ein Test namens
*„every order event carries an id"* direkt daneben in der Suite steht und grün
bleibt.

## Am eigenen Projekt

```bash
node bin/dead-filters.mjs --root src --prefix "event." --writer-key type
node bin/second-lists.mjs --root src
node bin/control-chars.mjs --report --root src --root docs
```

`dead-filters` muss die eigenen Konventionen kennen: `--prefix` ist der gemeinsame
Anfang der Ereignis-Literale, `--writer-key` die Eigenschaft, über die ein
Ereignis geschrieben wird (`{ type: "…" }`, `{ kind: "…" }`). Beides ist wichtig —
siehe unten.

Für `mutation-proof` schreibt man eine Liste dessen, was gebrochen werden soll:

```json
{
  "cwd": ".",
  "cmd": "node --test \"test/*.test.js\"",
  "kind": "node",
  "mutations": [
    {
      "name": "der Auth-Wächter weist ein leeres Token ab",
      "file": "src/auth.js",
      "from": "if (!token) throw new Error(\"unauthorized\");",
      "to":   "if (false) throw new Error(\"unauthorized\");"
    }
  ]
}
```

`kind` ist `node` (TAP) oder `vitest` (JSON). Die Datei wird immer
zurückgeschrieben, auch wenn der Lauf abstürzt. Steht `from` nicht in der Datei,
ist das Ergebnis UNCLEAR — nie ein stilles Überspringen.

## Was diese Werkzeuge nicht finden

Dieser Abschnitt ist absichtlich länger als die Merkmalsliste.

**Ein Treffer ist belastbar. Ein Nicht-Treffer nicht.** Jede Zahl, die diese
Werkzeuge drucken, ist eine Untergrenze. Drei der vier arbeiten über Textsuche,
und Textsuche hat blinde Flecken, die durch keine Sorgfalt verschwinden:

- **`dead-filters`** sieht String-Literale. Ereignisse, die aus Template-Literalen
  gebaut werden (`` `event.${domain}.created` ``), sind für es unsichtbar — auf
  beiden Seiten. Ebenso Ereignisse, die in Konstanten stehen — und genau diese
  Form ist die *bessere*, eben weil sie nicht driften kann. **Ein Projekt, das
  alle seine Ereignisse über Konstanten benennt, bekommt hier null Treffer, und
  das ist Blindheit, kein sauberes Zeugnis.** Es zählt außerdem Literale in
  Kommentaren mit, und Berechtigungs-Geltungsbereiche, und Namensräume, weil das
  für eine Literalsuche alles gleich aussieht. Die Zeilen lesen, nicht die Zahl.

- **`second-lists`** erfasst einzeilige Unions. Eine Union, die über Zeilen
  umbricht oder einen Kommentar enthält, entgeht ihm vollständig. Abgeleitete
  Typen (`type X = (typeof LIST)[number]`) sind ebenfalls unsichtbar — absichtlich,
  denn das ist die Lösung und nicht der Befund.

- **`control-chars`** findet *rohe* Zeichen. Ein Escape, das falsch ist (`\x08`
  wo `\b` gemeint war), ist für es unsichtbar und kann trotzdem ein Defekt sein.
  Es hätte den Vorfall gefunden, der zu ihm geführt hat; es findet nicht jeden
  seiner Art.

- **`mutation-proof`** belegt, dass *ein* Test rot wurde. Ob es *deiner* war, ist
  eine Frage, die es an dich zurückgibt — mit Namen.

## Voraussetzungen

Node 20 oder neuer. Keine Abhängigkeiten — die Werkzeuge nutzen nur Node-Bordmittel.

`second-lists` liest TypeScript *als Text* und führt es nie aus, es braucht also
keine TypeScript-Werkzeugkette.

## Es isst sein eigenes Hundefutter

```bash
npm run check     # das control-chars-Gate, dann die Testsuite
```

71 Tests decken die vier Werkzeuge ab, darunter Tests, die zusichern, dass die
Werkzeuge Dinge **übersehen** — die blinden Flecken von oben stehen dort, wo sie
nachprüfbar sind, damit niemand einen sauberen Lauf als „da ist nichts" liest.

Die eigene Steuerzeichen-Grundlinie des Repos hat genau einen Eintrag: ein
absichtliches Nullbreiten-Zeichen in einer Testdatei, mit Begründung und
nachgemessener Anzahl.

## Autoren

**Ömer Coskun** ([@oemer-coskun](https://github.com/oemer-coskun)) — die Werkzeuge,
die Vorfälle dahinter und die Regeln, die aus beidem wurden.

Gebaut mit [Claude Code](https://claude.com/claude-code), das die Arbeit
übernommen hat, sie aus dem Projekt herauszulösen, in dem sie entstanden sind,
und in etwas zu überführen, das auch woanders läuft.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
