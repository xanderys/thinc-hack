"use client";
import { createContext, useContext } from "react";

/** What the screen is about: the open lead on a lead page, nothing on the board. */
export type CopilotContext = { leadId?: string; name?: string };
export const Ctx = createContext<CopilotContext>({});
export const useCopilotContext = () => useContext(Ctx);
