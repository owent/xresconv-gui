import type { messages } from "./en";

export type MessageKey = keyof typeof messages;
export type Messages = { [Key in MessageKey]: string };
type Placeholders<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;
export type MessageArgs<Key extends MessageKey> = [Placeholders<(typeof messages)[Key]>] extends [
  never,
]
  ? [params?: undefined]
  : [params: Record<Placeholders<(typeof messages)[Key]>, string | number>];
