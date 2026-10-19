import type { StudyDefinition } from './model';

const english = {
  scale: { disagree: 'Disagree', undecided: 'Undecided', agree: 'Agree' },
  introduction: 'A guided sorting exercise', completed: 'Both rounds saved',
  reflection: 'A moment to reflect', comparison: 'Compare your two perspectives',
  saved: 'is saved.', result: 'your result', discuss: 'Talk through your choices',
  roundQuestions: ['Why these images at the two extremes?', 'Which placement was hardest to decide? What was your reason?'],
  steps: ['1 · Sort the images', '2 · Discuss your choices', '3 · Try a second perspective'],
  instructions: [
    'Drag every image into a place on the scale. Move images again whenever you change your mind. Double-click an image to enlarge it.',
    'Left means disagreement, the middle means undecided, and right means agreement. Rows are extra places within the same score. Fill every place; there is no right or wrong answer.',
  ],
  rolesTitle: 'For the two companions',
  roles: 'One person listens to the reasons and asks open questions after each round. The other observes hesitation, revisions and requests for help. Let the participant decide the placements; do not suggest a correct answer.',
  local: 'Sorting movements are recorded automatically. No audio or screen video is recorded. Results stay in this browser; export them at the end.',
  nextRound: 'The same images will be mixed again on an empty grid. Sort them according to this new statement.',
  compareQuestions: ['Which cards changed position most, and why?', 'How did the different tasks affect your choices?'],
  exportTitle: 'Save your work',
  export: 'Select Export study and keep the downloaded ZIP. It contains both sorts, replays, images, credits and results.csv. Hand the file to your instructor using the agreed course channel. Results are not sent automatically.',
  exported: 'The download has started. Check that the ZIP is in Downloads and keep a copy before leaving this computer. You can then finish the exercise.',
  newParticipant: 'For the next participant: this creates a fresh project and preserves these results.',
  about: 'About this exercise and image credits',
  replayHint: 'Play recording starts playback. Pause or drag the timeline to revisit a decision; ask about the reasons. Back to study returns to your discussion.',
};

const german: typeof english = {
  scale: { disagree: 'Stimme nicht zu', undecided: 'Unentschieden', agree: 'Stimme zu' },
  introduction: 'Eine angeleitete Sortierübung', completed: 'Beide Durchgänge gespeichert',
  reflection: 'Kurz besprechen', comparison: 'Zwei Perspektiven vergleichen',
  saved: 'ist gespeichert.', result: 'deine Sortierung', discuss: 'Eure Entscheidungen besprechen',
  roundQuestions: ['Warum liegen diese Bilder an den beiden Extremen?', 'Welche Platzierung war besonders schwierig? Was war deine Überlegung dabei?'],
  steps: ['1 · Bilder sortieren', '2 · Entscheidungen besprechen', '3 · Zweite Perspektive ausprobieren'],
  instructions: [
    'Ziehe jedes Bild auf einen Platz der Skala. Du kannst Bilder jederzeit umsortieren. Ein Doppelklick vergrößert ein Bild.',
    'Links bedeutet Ablehnung, die Mitte unentschieden, rechts Zustimmung. Die senkrechten Reihen sind zusätzliche Plätze mit demselben Wert. Belege alle Plätze; es gibt keine richtige oder falsche Lösung.',
  ],
  rolesTitle: 'Für die beiden Begleiterinnen und Begleiter',
  roles: 'Eine Person hört auf die Begründungen und stellt nach jedem Durchgang offene Fragen. Die andere beobachtet Zögern, Änderungen und Hilfebedarf. Lasst die sortierende Person selbst entscheiden und gebt keine richtige Platzierung vor.',
  local: 'Die Sortierbewegungen werden automatisch aufgezeichnet, aber kein Ton und kein Bildschirmvideo. Ergebnisse bleiben in diesem Browser; exportiert sie am Schluss.',
  nextRound: 'Dieselben Bilder werden auf einem leeren Raster neu gemischt. Sortiere sie jetzt nach der neuen Aussage.',
  compareQuestions: ['Welche Karten haben ihre Position besonders stark verändert? Warum?', 'Wie haben die unterschiedlichen Aufgaben eure Entscheidungen beeinflusst?'],
  exportTitle: 'Ergebnisse sichern',
  export: 'Klickt auf Export study und behaltet die heruntergeladene ZIP-Datei. Sie enthält beide Sortierungen, Replays, Bilder, Bildnachweise und results.csv. Gebt die Datei über den im Seminar vereinbarten Weg ab. Sie wird nicht automatisch versendet.',
  exported: 'Der Download wurde gestartet. Prüft, ob die ZIP-Datei im Downloadordner liegt, und sichert eine Kopie, bevor ihr den Rechner verlasst. Danach ist die Übung abgeschlossen.',
  newParticipant: 'Für die nächste Person: Ein neues Projekt wird angelegt; diese Ergebnisse bleiben erhalten.',
  about: 'Über die Übung und die Bildnachweise',
  replayHint: 'Play recording startet die Wiedergabe. Mit Pause oder dem Zeitregler könnt ihr eine Entscheidung erneut anschauen und nach den Gründen fragen. Back to study führt zur Besprechung zurück.',
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
    rolesTitle: de ? 'Für die Begleitung' : 'For facilitators',
    roles: de ? 'Lasst die sortierende Person selbst entscheiden. Fragt nach den Begründungen und beobachtet Zögern, Änderungen und Hilfebedarf. Gebt keine richtige Platzierung vor.'
      : 'Let the participant decide the placements. Ask about their reasons and observe hesitation, revisions and requests for help. Do not suggest a correct answer.',
    export: de ? 'Klickt auf Export study und behaltet die heruntergeladene ZIP-Datei. Sie enthält die Sortierungen, Replays, Karten, Bildnachweise und results.csv. Ergebnisse werden nicht automatisch versendet.'
      : 'Select Export study and keep the downloaded ZIP. It contains the sorts, replays, cards, credits and results.csv. Results are not sent automatically.',
  };
}
