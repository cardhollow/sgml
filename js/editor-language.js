/*
 * SGML editor language profile.
 * Add or adjust syntax by editing this data file; the editor engine stays generic.
 */
window.SGML_EDITOR_LANGUAGE = {
  tags: [
    { name: "st", description: "Styled text", insert: "st" },
    { name: "encircle", description: "Draw a hand-marked circle around text", insert: "encircle" },
    { name: "info", description: "Expandable information panel", insert: "info" },
    { name: "ref", description: "Link to a document reference", insert: "ref" },
    { name: "spoiler", description: "Reveal hidden content", insert: "spoiler" },
    { name: "root", description: "Expandable tree root", insert: "root" },
    { name: "bh", description: "Tree branch", insert: "bh" },
    { name: "line", description: "Expandable vertical timeline", insert: "line" },
    { name: "node", description: "Timeline or tree node", insert: "node" },
    { name: "Choices", openingSuffix: ":", description: "Multiple-choice question", insert: "Choices:" },
    { name: "Fillin", openingSuffix: ":", description: "Fill-in-the-blank question", insert: "Fillin:" },
    { name: "Enumeration", openingSuffix: ":", description: "Enumeration question", insert: "Enumeration:" },
    { name: "connect", openingSuffix: ":", description: "Matching question", insert: "connect:" },
    { name: "flashcard", description: "Flashcard set", insert: "flashcard" },
    { name: "tree", description: "Tree visualization", insert: "tree" },
    { name: "div", description: "HTML container", insert: "div" },
    { name: "span", description: "Inline HTML container", insert: "span" },
    { name: "p", description: "Paragraph", insert: "p" },
    { name: "h1", description: "Heading 1", insert: "h1" },
    { name: "h2", description: "Heading 2", insert: "h2" },
    { name: "h3", description: "Heading 3", insert: "h3" },
    { name: "h4", description: "Heading 4", insert: "h4" },
    { name: "h5", description: "Heading 5", insert: "h5" },
    { name: "h6", description: "Heading 6", insert: "h6" },
    { name: "ul", description: "Bulleted list", insert: "ul" },
    { name: "ol", description: "Numbered list", insert: "ol" },
    { name: "li", description: "List item", insert: "li" },
    { name: "strong", description: "Bold text", insert: "strong" },
    { name: "em", description: "Emphasized text", insert: "em" },
    { name: "code", description: "Inline code", insert: "code" },
    { name: "pre", description: "Preformatted code", insert: "pre" },
    { name: "table", description: "Table", insert: "table" },
    { name: "tr", description: "Table row", insert: "tr" },
    { name: "th", description: "Table header cell", insert: "th" },
    { name: "td", description: "Table cell", insert: "td" },
    { name: "svg", description: "SVG graphic", insert: "svg" },
    { name: "path", description: "SVG path", insert: "path" },
    { name: "rect", description: "SVG rectangle", insert: "rect" },
    { name: "circle", description: "SVG circle", insert: "circle" },
    { name: "img", description: "Image", insert: "img" },
    { name: "video", description: "Video", insert: "video" },
    { name: "audio", description: "Audio", insert: "audio" },
    { name: "br", description: "Line break", insert: "br" },
    { name: "hr", description: "Horizontal rule", insert: "hr" }
  ],
  attributes: [
    { name: "title", description: "Display title", insert: "title:" },
    { name: "id", description: "Reference identifier", insert: "id:" },
    { name: "bg", description: "Background color", insert: "bg:" },
    { name: "col", description: "Text color", insert: "col:" },
    { name: "type", description: "Component or input type", insert: "type:" },
    { name: "width", description: "Width", insert: "width:" },
    { name: "height", description: "Height", insert: "height:" },
    { name: "src", description: "Source URL", insert: "src:" },
    { name: "alt", description: "Alternative text", insert: "alt:" },
    { name: "href", description: "Link URL", insert: "href:" },
    { name: "class", description: "CSS class", insert: "class:" },
    { name: "align", description: "Alignment", insert: "align:" },
    { name: "border", description: "Border style", insert: "border:" },
    { name: "size", description: "Size", insert: "size:" },
    { name: "count", description: "Number of answers", insert: "count:" },
    { name: "shuffle", description: "Shuffle answer order", insert: "shuffle:" },
    { name: "case", description: "Case-sensitive answers", insert: "case:" },
    { name: "inorder", description: "Require ordered answers", insert: "inorder:" },
    { name: "x", description: "Horizontal coordinate", insert: "x=" },
    { name: "y", description: "Vertical coordinate", insert: "y=" },
    { name: "viewBox", description: "SVG coordinate viewBox", insert: "viewBox=" },
    { name: "xmlns", description: "XML namespace", insert: "xmlns=" }
  ],
  tagAttributes: {
    st: ["bg", "col"],
    encircle: ["col"],
    info: ["title", "bg", "col"],
    ref: ["id"],
    spoiler: ["title"],
    node: ["title", "id"],
    root: ["title"],
    Choices: ["count", "shuffle"],
    Fillin: ["case"],
    Enumeration: ["count", "case", "inorder", "type"],
    connect: ["shuffle"],
    flashcard: ["title", "shuffle"],
    svg: ["width", "height", "viewBox", "xmlns", "role", "aria-labelledby"],
    rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width"],
    path: ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"],
    img: ["src", "alt", "width", "height"],
    video: ["src", "width", "height", "controls"],
    audio: ["src", "controls"]
  },
  values: {
    colors: [
      { name: "ffff00", description: "Yellow highlight", insert: "ffff00" },
      { name: "fff3cd", description: "Pale yellow", insert: "fff3cd" },
      { name: "e0f2fe", description: "Pale blue", insert: "e0f2fe" },
      { name: "dcfce7", description: "Pale green", insert: "dcfce7" },
      { name: "fee2e2", description: "Pale red", insert: "fee2e2" },
      { name: "ffffff", description: "White", insert: "ffffff" },
      { name: "111111", description: "Near black", insert: "111111" },
      { name: "2563eb", description: "Blue", insert: "2563eb" },
      { name: "15803d", description: "Green", insert: "15803d" },
      { name: "b91c1c", description: "Red", insert: "b91c1c" }
    ],
    booleans: [
      { name: "true", description: "Enabled", insert: "true" },
      { name: "false", description: "Disabled", insert: "false" }
    ]
  },
  snippets: [
    { trigger: "st", description: "Styled text", insert: "<st bg:#ffff00 col:#111111>$0</st>" },
    { trigger: "encircle", description: "Hand-drawn circle around text", insert: "<encircle col:#c62828>$0</encircle>" },
    { trigger: "info", description: "Information panel", insert: "<info title:\"$0\">\n  Information text.\n</info>" },
    { trigger: "ref", description: "Reference link", insert: "<ref id:\"$0\">Link text</ref>" },
    { trigger: "spoiler", description: "Hidden content", insert: "<spoiler title:\"Reveal\">\n  $0\n</spoiler>" },
    { trigger: "Choices", description: "Multiple-choice question", insert: "<Choices:($0)[Option A, Option B, Option C, Option D]{[idx:0]}>" },
    { trigger: "Fillin", description: "Fill-in question", insert: "<Fillin:($0)[]{Answer|case:false}>" },
    { trigger: "Enumeration", description: "Enumeration question", insert: "<Enumeration:($0)[]{One,Two,Three|count:3|case:false|inorder:false}>" },
    { trigger: "connect", description: "Matching question", insert: "<connect:($0)[[Left A,Left B][Right A,Right B]]{answers:[[idx:0][idx:0]],[[idx:1][idx:1]]}>" },
    { trigger: "flashcard", description: "Flashcard set", insert: "<flashcard(Review)[[Question 1][Question 2]]{answers:[Answer 1,Answer 2]}>" },
    { trigger: "root", description: "Expandable tree", insert: "<root>\n  <bh>\n    <st bg:#e0f2fe>$0</st>\n    <bh>\n      Branch content.\n    </bh>\n  </bh>\n</root>" },
    { trigger: "line", description: "Timeline", insert: "<line>\n  <node title:\"Origin\">\n    $0\n  </node>\n  <node title:\"Development\">\n    Description.\n  </node>\n</line>" },
    { trigger: "node", description: "Timeline node", insert: "<node title:\"$0\">\n  Node content.\n</node>" },
    { trigger: "heading", description: "Markdown heading", insert: "## $0" },
    { trigger: "codeblock", description: "Fenced code block", insert: "```\n$0\n```" }
  ],

  /*
   * Declarative, context-aware SGML completions. The editor engine only evaluates
   * these rules; add new syntax by adding vocabulary and a pattern here.
   */
  contextSuggestionSets: {
    questionParams: {
      choices: [
        { name: "case", insert: "case:", description: "Case-sensitive answer comparison", kind: "param" }
      ],
      fillin: [
        { name: "case", insert: "case:", description: "Case-sensitive answer comparison", kind: "param" }
      ],
      enumeration: [
        { name: "count", insert: "count:", description: "Number of answers required", kind: "param" },
        { name: "case", insert: "case:", description: "Case-sensitive answer comparison", kind: "param" },
        { name: "inorder", insert: "inorder:", description: "Require answers in the listed order", kind: "param" },
        { name: "type", insert: "type:", description: "Enumeration mode; use order for ordering tasks", kind: "param" }
      ],
      connect: [
        { name: "shuffle", insert: "shuffle:", description: "Shuffle both matching columns", kind: "param" }
      ],
      flashcard: [
        { name: "shuffle", insert: "shuffle:", description: "Enable the shuffle control and randomize cards", kind: "param" }
      ],
      answerField: [
        { name: "answers", insert: "answers:", description: "Introduce the answer list or matching answer pairs", kind: "param" }
      ]
    },
    values: {
      booleans: [
        { name: "true", insert: "true", description: "Enabled", kind: "value" },
        { name: "false", insert: "false", description: "Disabled", kind: "value" }
      ],
      enumerationTypes: [
        { name: "order", insert: "order", description: "Drag/reorder items and check their order", kind: "value" }
      ],
      counts: [
        { name: "1", insert: "1", description: "One answer", kind: "value" },
        { name: "2", insert: "2", description: "Two answers", kind: "value" },
        { name: "3", insert: "3", description: "Three answers", kind: "value" },
        { name: "4", insert: "4", description: "Four answers", kind: "value" },
        { name: "5", insert: "5", description: "Five answers", kind: "value" },
        { name: "10", insert: "10", description: "Ten answers", kind: "value" }
      ],
      answerIndexField: [
        { name: "idx", insert: "idx:", description: "Zero-based answer index, such as idx:0", kind: "param" }
      ],
      answerIndexes: Array.from({ length: 10 }, (_, index) => ({
        name: String(index), insert: String(index), description: "Zero-based index " + index, kind: "value"
      }))
    }
  },
  contextRules: [
    { pattern: "<connect\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{\\s*[A-Za-z_]*$", items: "questionParams.answerField", flags: "i" },
    { pattern: "<flashcard\\s*:?\\s*(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{\\s*[A-Za-z_]*$", items: "questionParams.answerField", flags: "i" },
    { pattern: "<Choices\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\|\\s*[A-Za-z_]*$", items: "questionParams.choices", flags: "i" },
    { pattern: "<Fillin\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\|\\s*[A-Za-z_]*$", items: "questionParams.fillin", flags: "i" },
    { pattern: "<Enumeration\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\|\\s*[A-Za-z_]*$", items: "questionParams.enumeration", flags: "i" },
    { pattern: "<connect\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\|\\s*[A-Za-z_]*$", items: "questionParams.connect", flags: "i" },
    { pattern: "<flashcard\\s*:?\\s*(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\|\\s*[A-Za-z_]*$", items: "questionParams.flashcard", flags: "i" },
    { pattern: "<(?:Choices|Fillin|Enumeration)\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\|\\s*case\\s*:\\s*[A-Za-z]*$", items: "values.booleans", flags: "i" },
    { pattern: "<Enumeration\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\|\\s*inorder\\s*:\\s*[A-Za-z]*$", items: "values.booleans", flags: "i" },
    { pattern: "<(?:connect|flashcard)\\s*:?[\\s]*(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\|\\s*shuffle\\s*:\\s*[A-Za-z]*$", items: "values.booleans", flags: "i" },
    { pattern: "<Enumeration\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\|\\s*type\\s*:\\s*[A-Za-z]*$", items: "values.enumerationTypes", flags: "i" },
    { pattern: "<Enumeration\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\|\\s*count\\s*:\\s*\\d*$", items: "values.counts", flags: "i" },
    { pattern: "<(?:Choices|connect)\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\[\\s*[A-Za-z_]*$", items: "values.answerIndexField", flags: "i" },
    { pattern: "<(?:Choices|connect)\\s*:(?:(?!<(?:Choices|Fillin|Enumeration|connect|flashcard)\\b)[\\s\\S])*\\{[^{}]*\\[\\s*idx\\s*:\\s*\\d*$", items: "values.answerIndexes", flags: "i" }
  ],

    voidTags: ["br", "hr", "img", "input", "meta", "link", "source", "path", "rect", "circle"]
};
