		const defaultSGML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title>SGML Viewer</title>
  <desc>SGML Viewer application icon</desc>
  <rect x="24" y="24" width="464" height="464" rx="96" fill="#ffffff"/>
  <rect x="40" y="40" width="432" height="432" rx="82" fill="none" stroke="#111111" stroke-width="20"/>
  <path d="M186 150 92 256l94 106" fill="none" stroke="#111111" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="m326 150 94 106-94 106" fill="none" stroke="#111111" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M278 122 234 390" fill="none" stroke="#111111" stroke-width="28" stroke-linecap="round"/>
</svg>

# Study Guide: SGML — Study Guide Markup Language

SGML is a Markdown-based markup language designed for study guides, formatted notes, and interactive quizzes.

---

## Getting Started

### Automatic Resource Caching

When the network is available, the viewer requests the newest app resources and refreshes its local cache. If a request fails or the device has no connection, it automatically falls back to the last successfully cached version.

<st col:#00aa00>Tip:</st> Open the viewer once while connected so the app files can be cached for the first offline visit.
---
<ref id:"topic">Go to End</ref>

### Load a File

To start studying, choose **Upload File** and select an \`.sgml\`, \`.txt\`, \`.md\`, \`.docx\`, or \`.pdf\` file. Text/SGML files are read as text. DOCX files are converted to HTML, while PDFs are converted to HTML from selectable text, then displayed through the existing SGML renderer. Scanned PDFs without extractable text need OCR before import.

<st bg:#fff3cd col:#8a6d3b>Example:</st>

<st col:#0066ff>my_study_guide.sgml</st>

---

### URL Commands

You can create or load documents from the viewer URL:

- \`?new\` creates a blank SGML document and opens the editor.
- \`?new=Week%207%20Reviewer\` creates a blank document named \`Week 7 Reviewer\`.
- \`?load=https%3A%2F%2Fexample.com%2Fguide.sgml\` imports SGML from a URL. The same parameter also accepts \`.docx\` and \`.pdf\` URLs, which are fetched and converted before rendering. Other domains must allow browser CORS access.
- \`?Queries=https%3A%2F%2Fexample.com%2Flecture.pdf\` is an alias for \`?load=\`. The lowercase \`?queries=\` and \`?query=\` aliases also work.
- \`?load=local:Week%207%20Reviewer\` opens a saved local document by its title.
- \`?gdrive=1FFtvJbfy5851dpgpibNXRBelzLDGt2iQ\` imports a publicly shared Google Drive file through the CORS proxy. Public DOCX/PDF downloads are converted before rendering.

The Google Drive file must be shared as **Anyone with the link — Viewer**. The viewer removes the processed \`load\`, \`Queries\`, \`queries\`, \`query\`, \`gdrive\`, or \`new\` command from the address bar, so a normal refresh will not create duplicate documents.

---
### Start Studying

Once an SGML file is loaded, read through the sections and answer the interactive questions.

Interactive elements can include:

<Choices:(What happens when the network is unavailable?)[The viewer uses cached resources, The editor deletes the current file, Questions become disabled, The document is uploaded automatically]{[idx:0]}>
<Fillin:(What file extension is commonly used for an SGML study guide?)[]{sgml,.sgml}>

---

## More Interactive Elements

### Connect

Match items from the first column with their partners in the second column.

<connect:(Match each element with its symbol)[[Hydrogen,Oxygen,Carbon][H,O,C]]{answers:[[idx:0][idx:0]],[[idx:1][idx:1]],[[idx:2][idx:2]]|shuffle:true}>

### Flashcards

Flashcards have no correct-answer validation. Reveal each card, study the answer, then mark yourself Correct, Wrong, or Skip.

<flashcard(Science Review)[[What is H2O?][What gas do plants use in photosynthesis?][What is the center of an atom called?]]{answers:[Water,Carbon dioxide,Nucleus]|shuffle:true}>

### Spoiler

The \`<spoiler>...</spoiler>\` element places a plain overlay directly over its rendered content. It behaves as an inline element like \`<st>\` or ordinary text, so it does not insert paragraph breaks or generated newlines around the content. The overlay automatically follows the rendered width and height of the content. Clicking the overlay reveals the content.

Inline example: This sentence contains <spoiler>hidden text</spoiler> and continues normally after it.

Formatted example: <spoiler><st col:#ff0000>Hidden red text</st></spoiler> stays in the same text flow.

The spoiler itself does not contain visible "Tap to reveal" text; the dark overlay is the only cover.

---

## Edit the Code

SGML is text-based, so the study guide can be edited directly.

Change the text, formatting, questions, and answers in the SGML source.

### Example

Original:

<st col:#ff0000>This is red text.</st>

Edited:

<st col:#00aa00>This is now green text.</st>

The SGML viewer reads the edited source and renders the result as a study guide.

---

## SGML Formatting

### Plain Text

Plain text can be written normally.

This is ordinary SGML text.

### Colored Text

Use the \`<st>\` element to format text.

<st col:#ff0000>Red Text</st>

<st col:#12ABEF bg:#f0f8ff>Blue Text with Background</st>

### Circled text

<encircle col:#c62828>Remember this important term</encircle>

### Nested Formatting

Formatting can be placed inside other formatting elements.

<st col:#ff0000>
Red outer
<st col:#00aa00>Green inner</st>
Back to red.
</st>

---

## Interactive Questions

### Multiple Choice

Use \`<Choices:...>\` to create a multiple-choice question.

<Choices:(What is <st col:#ff0000>2 + 2</st>?)[<st bg:#e0f2fe>4</st>, 3, 5, 6]{[idx:0]}>

The first part is the question.

The square brackets contain the available choices.

The final section contains the answer.

In this example:

<st col:#00aa00>[idx:0]</st>

means that the first choice is correct.

Another example:

<Choices:(Which city is the capital of France?)[Berlin, Madrid, Paris, Rome]{Paris}>

---

### Commas Inside Choices

A comma normally separates choices.

When a choice contains a comma, wrap that entire value in backticks.

Example:

<Choices:(Which city contains a comma in its name?)[Manila, \`Washington, D.C.\`, Cebu]{[idx:1]}>

The backticks tell the parser that the comma inside the wrapped value is part of the text and is not a choice separator.

This works for answers as well:

<Fillin:(Enter the full city name)[]{\`Washington, D.C.\`}>

The rendered answer is:

<st col:#0066ff>Washington, D.C.</st>

---

### Escaping

SGML supports backslash escaping for structural characters.

<st col:#0066ff>&#92;,</st>

means a literal comma.

<st col:#0066ff>&#92;|</st>

means a literal pipe.

<st col:#0066ff>&#92;&#96;</st>

means a literal backtick.

<st col:#0066ff>&#92;&#92;</st>

means a literal backslash.

Other structural characters can also be escaped when necessary.

Backslash escaping is processed before separators and backtick wrapping.

---

### Fill-in-the-Blank

Use \`<Fillin:...>\` when the learner must enter an answer.

<Fillin:(What is the capital of France?)[]{Paris}>

Multiple accepted answers can be separated by commas.

<Fillin:(What is 2 + 2?)[]{4,Four}>

Both \`4\` and \`Four\` are accepted.

A value containing a comma can be wrapped:

<Fillin:(What exact phrase is shown?)[]{\`Hello, world\`}>

Only one answer is defined here because the comma is inside the backtick-wrapped value.

---

### Enumeration

Use \`<Enumeration:...>\` for questions involving a collection of answers.

<Enumeration:(Name 3 Primary Colors)[]{Red,Green,Blue|count:3|case:false|inorder:false}>

The options after the answer separator can define additional rules.

\`count:3\`

Requires three answers.

\`case:false\`

Makes the answer comparison case-insensitive.

\`inorder:false\`

Does not require the answers to be entered in a particular order.

---

### Ordered Enumeration

Enumeration can also require a specific order.

<Enumeration:(Arrange these numbers in ascending order)[3, 1, 4, 2]{1,2,3,4|type:order}>

Here:

\`type:order\`

means that the sequence must be entered in the specified order.

---

# Information Panels

The \`<info>\` element creates a small underlined and gray ⓘ indicator.

Clicking the indicator opens a contextual information panel.

### Basic Information

<info>
	<p>This is additional information hidden behind the ⓘ indicator.</p>
</info>

### Information With Title

<info title:"Photosynthesis">
	<h3>Photosynthesis</h3>
	<p>Photosynthesis is the process plants use to convert light energy into chemical energy.</p>
</info>

### Colored Information Panel

<info title:"Important Note" bg:#fff3cd col:#7a5b00>
	<h3>Important</h3>
	<p>The background and text colors of the information panel can be customized.</p>
	<st col:#b45309>This is SGML formatted text inside the panel.</st>
</info>

### Information Can Contain SGML

<info title:"Interactive Information" bg:#eef6ff col:#174a73>
	<h3>Extra Information</h3>
	<p>Information panels can contain normal HTML and SGML rendering.</p>

	<st col:#2563eb>Blue formatted text.</st>

	<Choices:(Which element creates this information panel?)[\`<info>\`, \`<line>\`, \`<root>\`, \`<bh>\`]{[idx:0]}>
</info>

---

# Tree Graph

The \`<root>\` and \`<bh>\` elements are used to create expandable tree structures.

The root contains the main concept.

Each \`<bh>\` creates a separate branch.

### Example Tree

<root>
	<h3>Photosynthesis</h3>
	<p>The process plants use to convert light energy into chemical energy.</p>

	<info title:"Photosynthesis Definition" bg:#eef6ff col:#174a73>
		<p>Photosynthesis transforms light energy into chemical energy stored in organic molecules.</p>
	</info>

	<bh>
		<h3>Light-dependent Reactions</h3>
		<p>These reactions use sunlight to produce ATP and NADPH.</p>

		<bh>
			<h3>Chlorophyll</h3>
			<p>A green pigment that absorbs light energy for photosynthesis.</p>

			<info>
				<p>Chlorophyll is especially important because it absorbs light used during photosynthesis.</p>
			</info>
		</bh>

		<bh>
			<h3>ATP Production</h3>
			<p>Light energy contributes to the production of ATP.</p>
		</bh>
	</bh>

	<bh>
		<h3>Calvin Cycle</h3>
		<p>A series of reactions that uses ATP and NADPH to produce sugars.</p>

		<bh>
			<h3>Carbon Fixation</h3>
			<p>Carbon dioxide is incorporated into an organic molecule.</p>
		</bh>

		<bh>
			<h3>Sugar Production</h3>
			<p>The cycle contributes to the production of glucose and other sugars.</p>
		</bh>
	</bh>
</root>

The tree starts with the root visible.

Click the root to reveal its branches.

Click a branch to reveal its own children.

Branches can contain HTML, Markdown-rendered content, \`<st>\`, \`<info>\`, and other supported SGML content.

---

# Line Node

The \`<line>\` element creates an expandable vertical sequence.

Each \`<node>\` has a \`title:\` that becomes the visible node.

### Example Line

<line>
	<node title:"Origin">
		<h3>The Beginning</h3>
		<p>The concept was first introduced as an early idea.</p>

		<info title:"Origin Details">
			<p>Additional information about the beginning of the process is shown here.</p>
		</info>
	</node>

	<node title:"Development">
		<h3>Development</h3>
		<p>During development, new techniques and ideas were introduced.</p>

		<ul>
			<li>New methods were introduced.</li>
			<li>Existing systems were improved.</li>
		</ul>

		<st col:#2563eb>Development expanded the original concept.</st>
	</node>

	<node title:"Expansion">
		<h3>Expansion</h3>
		<p>The system became more widely used and additional features were created.</p>

		<info title:"Expansion Information" bg:#f0fdf4 col:#166534>
			<p>The expansion stage introduced additional capabilities.</p>
		</info>
	</node>

	<node title:"Modern Era">
		<h3>Modern Era</h3>
		<p>The modern version contains the concepts and technologies developed throughout the timeline.</p>
	</node>
</line>

The first node is displayed initially.

Click the current node to reveal the next node.

Click an earlier visible node to collapse everything after that node.

---

# How SGML Works

SGML works by storing the study guide as plain text.

The viewer reads the SGML source and processes its markup.

---
~~~Bar Graph
<svg width="100%" height="300" viewBox="0 0 600 300" xmlns="http://www.w3.org/2000/svg">
	<style>
		.bar{fill:#4f8cff}
		.bar:hover{fill:#2563eb}
		.label{font-family:Arial,sans-serif;font-size:14px;fill:#222}
		.value{font-family:Arial,sans-serif;font-size:13px;fill:#555}
		.axis{stroke:#333;stroke-width:2}
	</style>

	<line x1="60" y1="20" x2="60" y2="250" class="axis"/>
	<line x1="60" y1="250" x2="570" y2="250" class="axis"/>

	<rect x="90" y="170" width="60" height="80" class="bar"/>
	<rect x="190" y="110" width="60" height="140" class="bar"/>
	<rect x="290" y="70" width="60" height="180" class="bar"/>
	<rect x="390" y="130" width="60" height="120" class="bar"/>
	<rect x="490" y="40" width="60" height="210" class="bar"/>

	<text x="120" y="160" text-anchor="middle" class="value">40</text>
	<text x="220" y="100" text-anchor="middle" class="value">70</text>
	<text x="320" y="60" text-anchor="middle" class="value">90</text>
	<text x="420" y="120" text-anchor="middle" class="value">60</text>
	<text x="520" y="30" text-anchor="middle" class="value">105</text>

	<text x="120" y="275" text-anchor="middle" class="label">Monday</text>
	<text x="220" y="275" text-anchor="middle" class="label">Tuesday</text>
	<text x="320" y="275" text-anchor="middle" class="label">Wednesday</text>
	<text x="420" y="275" text-anchor="middle" class="label">Thursday</text>
	<text x="520" y="275" text-anchor="middle" class="label">Friday</text>
</svg>
~~~
---
~~~Interactive SVG
<svg width="100%" height="220" viewBox="0 0 500 220" xmlns="http://www.w3.org/2000/svg">
	<rect x="0" y="0" width="500" height="220" fill="#fff"/>
	<rect id="box" x="170" y="60" width="160" height="80" rx="10" fill="#4f8cff"/>
	<text x="250" y="105" text-anchor="middle" font-family="Arial" font-size="18" fill="#fff">Click the button</text>
</svg>

<button onclick="document.getElementById('box').style.fill='#22c55e';document.getElementById('message').textContent='The SVG was changed!'">Change SVG</button>
<p id="message">Nothing happened yet.</p>
~~~
---
## 1. SGML Source

The original document is text.

Example:

<Choices:(What is 2 + 2?)[4,3,5,6]{[idx:0]}>

---

## 2. Parser

The SGML parser searches the document for recognized structures.

For example:

\`<st ...>\`

is recognized as a formatting element.

\`<Choices:...>\`

is recognized as a multiple-choice question.

\`<Fillin:...>\`

is recognized as a fill-in-the-blank question.

\`<Enumeration:...>\`

is recognized as an enumeration question.

\`<info>\`

is recognized as an information panel.

\`<root>\`

is recognized as a tree root.

\`<bh>\`

is recognized as a tree branch.

\`<line>\`

is recognized as a line-node container.

\`<node>\`

is recognized as an individual line node.

When parsing a choice list:

- commas outside backticks separate values
- commas inside backticks are literal
- escaped separators are literal
- escaped backticks do not start or end a wrapped value

---

## 3. Formatting

When the parser encounters formatting attributes such as:

<st col:#ff0000>Red</st>

it interprets:

\`col:#ff0000\`

as the text color.

For example:

<st col:#ff0000>Red</st>

renders as red text.

A background can also be supplied:

<st col:#12ABEF bg:#f0f8ff>Blue Text with Background</st>

---

## 4. Information Panels

The \`<info>\` element is rendered as a small ⓘ indicator.

The information is hidden until the indicator is clicked.

An information panel can have optional attributes:

\`title:\`

controls the panel header.

\`bg:\`

controls the background theme.

\`col:\`

controls the text color.

Example:

<info title:"Example" bg:#eef6ff col:#174a73>
	<p>This is an information panel.</p>
</info>

The contents can still contain HTML and SGML formatting.

---

## 5. Tree Parsing

A tree begins with:

\`<root>\`

Branches are created with:

\`<bh>\`

A branch can contain additional nested \`<bh>\` elements.

Example:

<root>
	<h3>Root</h3>

	<bh>
		<h3>Branch A</h3>

		<bh>
			<h3>Branch A1</h3>
		</bh>
	</bh>

	<bh>
		<h3>Branch B</h3>
	</bh>
</root>

The viewer renders the hierarchy graphically and connects each branch to its parent.

---

## 6. Line Node Parsing

A line begins with:

\`<line>\`

Each node is created with:

\`<node title:"...">\`

Example:

<line>
	<node title:"First">
		<p>The first stage.</p>
	</node>

	<node title:"Second">
		<p>The second stage.</p>
	</node>

	<node title:"Third">
		<p>The third stage.</p>
	</node>
</line>

The nodes are displayed progressively and can be expanded or collapsed.

---

## 7. Question Parsing

An interactive question contains different parts.

Example:

<Choices:(What is 2 + 2?)[4,3,5,6]{[idx:0]}>

The parser can interpret it as:

Question:

\`What is 2 + 2?\`

Choices:

\`4, 3, 5, 6\`

Correct answer:

\`[idx:0]\`

Therefore the viewer knows which answer should be accepted.

A wrapped choice is parsed as one value:

<Choices:(Example)[Apple, \`Washington, D.C.\`, Banana]{[idx:1]}>

The comma inside \`Washington, D.C.\` does not create another choice.

Literal backtick values can also contain SGML-looking text:

<Choices:(Which custom element displays an information indicator?)[\`<info>\`,\`<line>\`,\`<root>\`,\`<bh>\`]{[idx:0]}>

These values are treated as plaintext.

---

## 8. Validation

After the learner submits an answer, the viewer compares it with the answer stored in the SGML.

For example:

<Fillin:(What is 2 + 2?)[]{4,Four, \`<four>\`}>

The viewer can accept:

\`4\`

or:

\`Four\`

depending on the answer rules implemented by the viewer.

---

## 9. Markdown Structure

SGML also uses Markdown-style structure.

A heading such as:

## Formatting

creates a section.

A larger heading such as:

# Study Guide: SGML

creates the main title.

This makes SGML easy to write and edit as ordinary text.

---

## 10. Network-Aware Resource Caching

The viewer checks the network automatically. Online requests load current resources and refresh the local cache. When a request fails, the most recently cached resource is used as a fallback.

Saved SGML documents remain in this browser's local storage and do not require an internet connection to reopen.

<st col:#00aa00>Network available → Load new resources → Refresh cache</st>

<st bg:#e0f2fe>No network → Automatically use cached resources</st>

---

## SGML Structure Summary

An SGML study guide can therefore contain:

<st col:#0066ff>Markdown</st>
for document structure.

<st col:#0066ff>&lt;st&gt;</st>
for formatting.

<st col:#0066ff>&lt;Choices&gt;</st>
for multiple-choice questions.

<st col:#0066ff>&lt;Fillin&gt;</st>
for text answers.

<st col:#0066ff>&lt;Enumeration&gt;</st>
for lists and ordered answers.

<st col:#0066ff>&lt;info&gt;</st>
for contextual information.

<st col:#0066ff>&lt;root&gt; + &lt;bh&gt;</st>
for expandable tree structures.

<st col:#0066ff>&lt;line&gt; + &lt;node&gt;</st>
for expandable line-node sequences.

Together, these components allow one \`.sgml\` file to contain both the learning material and the interactive quiz logic.

---

# Quick Practice

<Choices:(What does \`<st>\` primarily control?)[Text formatting, File downloading, Network connection, Audio playback]{[idx:0]}>

<Choices:(Which SGML element creates a multiple-choice question?)[<Fillin>, <Choices>, <Enumeration>, <st>]{<Choices>}>

<Choices:(Which custom element displays an information indicator?)[\`<info>\`,\`<line>\`,\`<root>\`,\`<bh>\`]{[idx:0]}>

<Choices:(Which element represents a tree branch?)[\`<node>\`, \`<bh>\`, \`<info>\`, \`<line>\`]{[idx:1]}>

<Choices:(Which element creates an expandable line structure?)[\`<root>\`, \`<bh>\`, \`<line>\`, \`<info>\`]{[idx:2]}>

<Fillin:(What markup is used for a fill-in-the-blank question?)[]{Fillin,<Fillin>}>

<Enumeration:(Put these SGML processing stages in order)[Validation, Source, Parser, Formatting]{Source,Parser,Formatting,Validation|type:order}>

<Choices:(Which answer contains a comma?)[Apple, \`Washington, D.C.\`, Banana]{[idx:1]}>

<Fillin:(Enter this exact phrase)[]{\`Hello, world\`}>

---

# Remember

<st col:#ff0000>SGML is text.</st>

<st col:#00aa00>Markdown provides the document structure.</st>

<st col:#0066ff>SGML tags add formatting and interactive behavior.</st>

<st col:#aa00aa>The viewer parses the source and turns it into an interactive study guide.</st>

<st col:#0066ff>Use backticks to wrap a value containing a separator such as a comma.</st>

<st col:#0066ff>Use literal backticks when SGML-looking text should remain plaintext.</st>

<st bg:#e0f2fe>Escaped characters are treated as literal characters instead of structural syntax.</st>

<st bg:#e0f2fe>The viewer automatically refreshes cached resources online and uses the cache when the network is unavailable.</st>

<st bg:#eef6ff col:#174a73><info title:"Custom Elements">Info panels, tree graphs, and line nodes support normal SGML content such as HTML, Markdown-rendered elements, and ST formatting.</info></st>

<ref id:"topic"/>
You can use SAIG to create SGML easily
https://gemini.google.com/gem/1TCc5lmYcFHr5piZ27QsNzA04Mvv49YiO`;

		async function loadDefaultSample(){
			const current=getCurrentDocument();
			if(!current){
				showToast('No current SGML document is available','error',5000);
				return;
			}
			const accepted=await confirmDialog(
				'Loading the sample will replace all code in the current editor and update the current document. This cannot be undone from this prompt. Continue?',
				'Load sample and replace current code?',
				'Replace with sample'
			);
			if(!accepted)return;
			showToast('Loading sample SGML…','loading',0);

			if(current){
				Editor.setValue(defaultSGML);

				current.content=defaultSGML;
				current.title=
					current.title==='Untitled SGML'||current.title==='Upload'
						?'Sample SGML'
						:current.title;

				current.updatedAt=Date.now();

				saveDocuments(
					loadDocuments().map(
						doc=>doc.id===current.id?current:doc
					)
				);

				localStorage.setItem(
					STORAGE_CURRENT_CONTENT,
					defaultSGML
				);

				updateCurrentName(current);
				renderSGML(defaultSGML);
				showToast('Sample SGML loaded','success');
			}else{
				showToast('No current SGML document is available','error',5000);
			}
		}

		function initializeLibrary(){
			let docs=loadDocuments();
			const savedId=localStorage.getItem(
				STORAGE_CURRENT_ID
			);
			const savedContent=localStorage.getItem(
				STORAGE_CURRENT_CONTENT
			);

			let current=docs.find(
				doc=>doc.id===savedId
			);

			if(!current&&docs.length){
				current=docs.slice().sort(
					(a,b)=>(b.updatedAt||0)-(a.updatedAt||0)
				)[0];
			}

			if(!current){
				current={
					id:makeId(),
					title:'Sample SGML',
					content:
						savedContent!==null
							?savedContent
							:defaultSGML,
					createdAt:Date.now(),
					updatedAt:Date.now()
				};

				docs.push(current);
				saveDocuments(docs);
			}else if(
				savedContent!==null&&
				current.id===savedId
			){
				current.content=savedContent;
				current.updatedAt=Date.now();

				saveDocuments(
					docs.map(
						doc=>doc.id===current.id?current:doc
					)
				);
			}

			currentDocumentId=current.id;

			localStorage.setItem(
				STORAGE_CURRENT_ID,
				current.id
			);

			localStorage.setItem(
				STORAGE_CURRENT_CONTENT,
				current.content||''
			);

			Editor.setValue(current.content||'');

			updateCurrentName(current);
			renderSGML(current.content||'');
		}

