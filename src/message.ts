export interface TextRun {
    type: 'run';
    text: string;
}

export interface Link {
    type: 'link';
    url: string;
    display?: string;
}

export interface Mention {
    type: 'mention';
    target: string;
}

export interface Decorated {
    type: 'strike' | 'bold' | 'italic';
    inner: (TextRun | Link | Decorated)[];
}

export type MessageItem = TextRun | Link | Mention | Decorated;
export type Message = MessageItem[];