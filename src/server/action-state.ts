// Shared between server actions and client forms; must stay free of server-only imports.
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

export const initialActionState: ActionState = { ok: false };
