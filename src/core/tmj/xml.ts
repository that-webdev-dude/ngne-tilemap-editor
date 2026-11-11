import { TmjError } from "./errors";

// A small XML reader for Tiled's TSX tilesets (SPEC §13: TSX parsed in `core/` without DOM
// globals). It reads what Tiled writes: a prolog, comments, elements with attributes, text,
// CDATA and the predefined and numeric character references. Anything else refuses the file.

export interface XmlElement {
    readonly name: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly children: XmlElement[];
    /** The element's own text, its children's left out, references decoded. */
    text: string;
}

const NAMED: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
};

const NAME = /[A-Za-z_:][-\w.:]*/y;
const SPACE = /\s*/y;

class Reader {
    private at = 0;

    constructor(
        private readonly text: string,
        private readonly what: string,
    ) {}

    fail(why: string): never {
        throw new TmjError("format", `${this.what} is not valid XML: ${why}.`);
    }

    get done(): boolean {
        return this.at >= this.text.length;
    }

    startsWith(prefix: string): boolean {
        return this.text.startsWith(prefix, this.at);
    }

    skip(count: number): void {
        this.at += count;
    }

    skipSpace(): void {
        SPACE.lastIndex = this.at;
        SPACE.exec(this.text);
        this.at = SPACE.lastIndex;
    }

    /** Everything up to `end`, which is consumed too. */
    until(end: string, what: string): string {
        const index = this.text.indexOf(end, this.at);
        if (index < 0) this.fail(`unclosed ${what}`);
        const value = this.text.slice(this.at, index);
        this.at = index + end.length;
        return value;
    }

    name(): string {
        NAME.lastIndex = this.at;
        const match = NAME.exec(this.text);
        if (match === null) this.fail(`a name is expected at offset ${this.at}`);
        this.at = NAME.lastIndex;
        return match[0];
    }

    expect(token: string): void {
        if (!this.startsWith(token)) this.fail(`"${token}" is expected at offset ${this.at}`);
        this.at += token.length;
    }

    decode(raw: string): string {
        let out = "";
        let from = 0;
        for (let amp = raw.indexOf("&"); amp >= 0; amp = raw.indexOf("&", from)) {
            const semi = raw.indexOf(";", amp);
            if (semi < 0) this.fail("an unterminated character reference");
            out += raw.slice(from, amp) + this.reference(raw.slice(amp + 1, semi));
            from = semi + 1;
        }
        return out + raw.slice(from);
    }

    private reference(body: string): string {
        const named = NAMED[body];
        if (named !== undefined) return named;
        const hex = /^#x([0-9a-fA-F]{1,6})$/.exec(body);
        const dec = /^#(\d{1,7})$/.exec(body);
        const code = hex ? parseInt(hex[1]!, 16) : dec ? parseInt(dec[1]!, 10) : -1;
        if (code < 0 || code > 0x10ffff) this.fail(`the reference &${body}; is unknown`);
        return String.fromCodePoint(code);
    }

    /** Skips comments, processing instructions and a document type at the current place. */
    skipMisc(): void {
        for (;;) {
            this.skipSpace();
            if (this.startsWith("<!--")) this.until("-->", "comment");
            else if (this.startsWith("<?")) this.until("?>", "processing instruction");
            else if (this.startsWith("<!DOCTYPE")) this.until(">", "document type");
            else return;
        }
    }

    element(): XmlElement {
        this.expect("<");
        const name = this.name();
        const attributes: Record<string, string> = {};
        for (;;) {
            this.skipSpace();
            if (this.startsWith("/>")) {
                this.skip(2);
                return { name, attributes, children: [], text: "" };
            }
            if (this.startsWith(">")) {
                this.skip(1);
                break;
            }
            const key = this.name();
            this.skipSpace();
            this.expect("=");
            this.skipSpace();
            const quote = this.text[this.at];
            if (quote !== '"' && quote !== "'") this.fail(`attribute ${key} is not quoted`);
            this.skip(1);
            if (Object.hasOwn(attributes, key)) this.fail(`attribute ${key} is repeated`);
            // XML normalises white space characters in attribute values to spaces (§3.3.3).
            attributes[key] = this.decode(this.until(quote, "attribute").replace(/[\t\n\r]/g, " "));
        }
        const element: XmlElement = { name, attributes, children: [], text: "" };
        for (;;) {
            if (this.done) this.fail(`element ${name} is not closed`);
            if (this.startsWith("</")) {
                this.skip(2);
                if (this.name() !== name) this.fail(`element ${name} is closed by another`);
                this.skipSpace();
                this.expect(">");
                return element;
            }
            if (this.startsWith("<!--")) this.until("-->", "comment");
            else if (this.startsWith("<![CDATA[")) {
                this.skip(9);
                element.text += this.until("]]>", "CDATA section");
            } else if (this.startsWith("<?")) this.until("?>", "processing instruction");
            else if (this.startsWith("<")) element.children.push(this.element());
            else {
                const end = this.text.indexOf("<", this.at);
                const raw = this.text.slice(this.at, end < 0 ? this.text.length : end);
                this.skip(raw.length);
                element.text += this.decode(raw);
            }
        }
    }
}

/** The root element of an XML document. Throws `TmjError` ("format") when it is malformed. */
export function parseXml(text: string, what: string): XmlElement {
    const body = text.codePointAt(0) === 0xfeff ? text.slice(1) : text;
    const reader = new Reader(body, what);
    reader.skipMisc();
    if (reader.done) reader.fail("the document is empty");
    const root = reader.element();
    reader.skipMisc();
    if (!reader.done) reader.fail("there is content after the root element");
    return root;
}
