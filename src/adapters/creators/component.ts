export interface Component {
  type: string
}

export interface TextComponent {
  type: "text";
  text: string;
}

export function TextComponent(text: string): TextComponent {
  return { type: "text", text };
}

export interface ImageComponent {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
}

export function ImageComponent(
  url: string,
  detail?: "low" | "high" | "auto"
): ImageComponent {
  return { type: "image_url", image_url: { url, detail } };
}

export interface Message {
  role: "system" | "assistant" | "user";
  content: string | Component[];
}

export interface SystemMessage extends Message {
  role: "system";
}

export interface UserMessage extends Message {
  role: "user";
}

export interface AssistantMessage extends Message {
  role: "assistant";
}

function wrapContent(content: Array<string | Component>): string | Component[] {
  if (content.length === 1 && typeof content[0] === "string") {
    return content[0];
  }
  return content.map((it) => (typeof it === "string" ? TextComponent(it) : it));
}

export function SystemMessage(
  ...content: Array<string | Component>
): SystemMessage {
  const wrappedContent = wrapContent(content);
  return {
    role: "system",
    content: wrappedContent,
  };
}

export function UserMessage(
  ...content: Array<string | Component>
): UserMessage {
  const wrappedContent = wrapContent(content);
  return {
    role: "user",
    content: wrappedContent,
  };
}

export function AssistantMessage(
  ...content: Array<string | Component>
): AssistantMessage {
  const wrappedContent = wrapContent(content);
  return {
    role: "assistant",
    content: wrappedContent,
  };
}