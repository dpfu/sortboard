import type { StudyDefinition } from './model';

const english = {
  scale: { disagree: 'Disagree', undecided: 'Undecided', agree: 'Agree' },
  introduction: 'A guided sorting exercise', completed: 'Both rounds saved',
  reflection: 'A moment to reflect', comparison: 'Compare your two perspectives',
  saved: 'is saved.', result: 'your result', discuss: 'Talk through your choices',
  roundQuestions: ['Why these images at the two extremes?', 'Which placement was hardest to decide? What was your reason?'],
  notes: 'Discussion notes', optional: '(optional)', notesPlaceholder: "The participant’s reasons, in their own words.",
  steps: ['1 · Sort the images', '2 · Discuss your choices', '3 · Try a second perspective'],
  instructions: [
    'Drag every image into a place on the scale. Move images again whenever you change your mind. Double-click an image to enlarge it.',
    'Left means disagreement, the middle means undecided, and right means agreement. Rows are extra places within the same score. Fill every place; there is no right or wrong answer.',
  ],
  rolesTitle: 'For the two companions',
  roles: 'One person listens to the reasons and asks open questions after each round. The other observes hesitation, revisions and requests for help. Let the participant decide the placements; do not suggest a correct answer.',
  local: 'Sorting movements are recorded automatically. No audio or screen video is recorded. Results stay in this browser; export them at the end.',
  nextRound: 'The same images will be mixed again on an empty grid. Sort them according to this new statement.',
  compareTitle: '1 · Compare the two sorts',
  compareQuestions: ['Which cards changed position most, and why?', 'How did the different tasks affect your choices?'],
  table: 'Each image under both statements', difference: 'Change', differenceHint: 'Change = round 2 minus round 1. This describes your placements, not an effect or a statistical result.',
  comparisonNotes: 'Comparison notes', comparisonPlaceholder: 'Two or three observations and the participant’s explanations.',
  replayTitle: '2 · Revisit decisions together',
  replay: 'Choose an interesting change or hesitation. Open a replay, press Play recording, then pause or move the timeline to that moment. Ask what the participant was thinking. Back to study returns here.',
  exportTitle: '3 · Save your work',
  export: 'Select Export study and keep the downloaded ZIP. It contains both sorts, replays, notes, images, credits and results.csv. Hand the file to your instructor using the agreed course channel. Results are not sent automatically.',
  exported: 'The download has started. Check that the ZIP is in Downloads and keep a copy before leaving this computer. You can then finish the exercise.',
  newParticipant: 'For the next participant: this creates a fresh project and preserves these results.',
  about: 'About this exercise and image credits',
  replayHint: 'Play recording starts playback. Pause or drag the timeline to revisit a decision; ask about the reasons. Back to study returns to the comparison.',
};

const german: typeof english = {
  scale: { disagree: 'Stimme nicht zu', undecided: 'Unentschieden', agree: 'Stimme zu' },
  introduction: 'Eine angeleitete Sortierübung', completed: 'Beide Durchgänge gespeichert',
  reflection: 'Kurz besprechen', comparison: 'Zwei Perspektiven vergleichen',
  saved: 'ist gespeichert.', result: 'deine Sortierung', discuss: 'Eure Entscheidungen besprechen',
  roundQuestions: ['Warum liegen diese Bilder an den beiden Extremen?', 'Welche Platzierung war besonders schwierig? Was war deine Überlegung dabei?'],
  notes: 'Gesprächsnotizen', optional: '(optional)', notesPlaceholder: 'Begründungen möglichst in den eigenen Worten der sortierenden Person.',
  steps: ['1 · Bilder sortieren', '2 · Entscheidungen besprechen', '3 · Zweite Perspektive ausprobieren'],
  instructions: [
    'Ziehe jedes Bild auf einen Platz der Skala. Du kannst Bilder jederzeit umsortieren. Ein Doppelklick vergrößert ein Bild.',
    'Links bedeutet Ablehnung, die Mitte unentschieden, rechts Zustimmung. Die senkrechten Reihen sind zusätzliche Plätze mit demselben Wert. Belege alle Plätze; es gibt keine richtige oder falsche Lösung.',
  ],
  rolesTitle: 'Für die beiden Begleiterinnen und Begleiter',
  roles: 'Eine Person hört auf die Begründungen und stellt nach jedem Durchgang offene Fragen. Die andere beobachtet Zögern, Änderungen und Hilfebedarf. Lasst die sortierende Person selbst entscheiden und gebt keine richtige Platzierung vor.',
  local: 'Die Sortierbewegungen werden automatisch aufgezeichnet, aber kein Ton und kein Bildschirmvideo. Ergebnisse bleiben in diesem Browser; exportiert sie am Schluss.',
  nextRound: 'Dieselben Bilder werden auf einem leeren Raster neu gemischt. Sortiere sie jetzt nach der neuen Aussage.',
  compareTitle: '1 · Beide Sortierungen vergleichen',
  compareQuestions: ['Welche Karten haben ihre Position besonders stark verändert? Warum?', 'Wie haben die unterschiedlichen Aufgaben eure Entscheidungen beeinflusst?'],
  table: 'Jedes Bild unter beiden Aussagen', difference: 'Veränderung', differenceHint: 'Veränderung = Durchgang 2 minus Durchgang 1. Das beschreibt eure Platzierungen, keinen Effekt und kein statistisches Ergebnis.',
  comparisonNotes: 'Notizen zum Vergleich', comparisonPlaceholder: 'Zwei bis drei Beobachtungen und die Erklärungen der sortierenden Person.',
  replayTitle: '2 · Entscheidungen gemeinsam nachverfolgen',
  replay: 'Wählt eine interessante Änderung oder einen Moment des Zögerns. Öffnet ein Replay und startet es mit Play recording. Haltet an oder bewegt den Zeitregler zur passenden Stelle. Fragt nach der damaligen Überlegung. Back to study führt hierher zurück.',
  exportTitle: '3 · Ergebnisse sichern',
  export: 'Klickt auf Export study und behaltet die heruntergeladene ZIP-Datei. Sie enthält beide Sortierungen, Replays, Notizen, Bilder, Bildnachweise und results.csv. Gebt die Datei über den im Seminar vereinbarten Weg ab. Sie wird nicht automatisch versendet.',
  exported: 'Der Download wurde gestartet. Prüft, ob die ZIP-Datei im Downloadordner liegt, und sichert eine Kopie, bevor ihr den Rechner verlasst. Danach ist die Übung abgeschlossen.',
  newParticipant: 'Für die nächste Person: Ein neues Projekt wird angelegt; diese Ergebnisse bleiben erhalten.',
  about: 'Über die Übung und die Bildnachweise',
  replayHint: 'Play recording startet die Wiedergabe. Mit Pause oder dem Zeitregler könnt ihr eine Entscheidung erneut anschauen und nach den Gründen fragen. Back to study führt zum Vergleich zurück.',
};

export function studyCopy(study: Pick<StudyDefinition, 'taskLanguage'> & Partial<StudyDefinition>) {
  const de = study.taskLanguage === 'de';
  const base = de ? german : english;
  const multiple = (study.rounds?.length || 1) > 1;
  return { ...base,
    scale: study.anchors || base.scale,
    completed: de ? 'Sortierung gespeichert' : 'Sorting saved',
    comparison: study.rounds?.length === 2 ? base.comparison : multiple ? (de ? 'Sortierungen vergleichen' : 'Compare your sorts') : (de ? 'Deine Sortierung' : 'Review your sort'),
    steps: de ? ['1 · Karten sortieren', '2 · Entscheidungen besprechen', ...(multiple ? ['3 · Weitere Perspektive ausprobieren'] : [])]
      : ['1 · Sort the cards', '2 · Discuss your choices', ...(multiple ? ['3 · Try another perspective'] : [])],
    instructions: de ? ['Ziehe jede Karte auf einen Platz der Skala. Du kannst jederzeit umsortieren. Ein Doppelklick vergrößert ein Bild.',
      'Orientiere dich an der Aufgabe und den Beschriftungen der Skala. Die senkrechten Reihen sind zusätzliche Plätze mit demselben Wert. Belege alle Plätze; es gibt keine richtige oder falsche Lösung.']
      : ['Drag every card into a place on the scale. Move cards again whenever you change your mind. Double-click an image to enlarge it.',
        'Use the task and scale labels as your guide. Rows are extra places within the same score. Fill every place; there is no right or wrong answer.'],
    roundQuestions: study.discussionQuestions || base.roundQuestions,
    compareQuestions: multiple ? study.comparisonQuestions || base.compareQuestions : study.discussionQuestions || base.roundQuestions,
    compareTitle: multiple ? (de ? '1 · Sortierungen vergleichen' : '1 · Compare the sorts') : (de ? '1 · Sortierung ansehen' : '1 · Review the sort'),
    table: de ? 'Platzierungen nach Aufgabe' : 'Placements by task',
    rolesTitle: de ? 'Für die Begleitung' : 'For facilitators',
    roles: de ? 'Lasst die sortierende Person selbst entscheiden. Fragt nach den Begründungen und beobachtet Zögern, Änderungen und Hilfebedarf. Gebt keine richtige Platzierung vor.'
      : 'Let the participant decide the placements. Ask about their reasons and observe hesitation, revisions and requests for help. Do not suggest a correct answer.',
    export: de ? 'Klickt auf Export study und behaltet die heruntergeladene ZIP-Datei. Sie enthält die Sortierungen, Replays, Notizen, Karten, Bildnachweise und results.csv. Ergebnisse werden nicht automatisch versendet.'
      : 'Select Export study and keep the downloaded ZIP. It contains the sorts, replays, notes, cards, credits and results.csv. Results are not sent automatically.',
  };
}
