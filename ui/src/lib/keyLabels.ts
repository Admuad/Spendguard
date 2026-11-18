"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Key names (labels) live only in this browser, in localStorage. The
 * contract has no name field, so a label never travels with the vault:
 * it is a local note that helps the owner tell keys apart in the
 * sessions list. Every hook instance on the page stays in sync through
 * a window event, so a name saved in the grant form appears in the
 * sessions list without a reload.
 */

const STORAGE_KEY = "spendguard-key-labels";
const CHANGE_EVENT = "spendguard-key-labels-changed";
const MAX_LABEL_LENGTH = 60;

export type KeyLabelMap = Record<string, string>;

function labelKey(vaultAddress: string, keyAddress: string): string {
  return `${vaultAddress.toLowerCase()}:${keyAddress.toLowerCase()}`;
}

function loadLabels(): KeyLabelMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const clean: KeyLabelMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim() !== "") {
        clean[key] = value.trim().slice(0, MAX_LABEL_LENGTH);
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function getKeyLabel(
  labels: KeyLabelMap,
  vaultAddress: string,
  keyAddress: string,
): string | null {
  return labels[labelKey(vaultAddress, keyAddress)] ?? null;
}

export function useKeyLabels() {
  const [labels, setLabels] = useState<KeyLabelMap>({});
  useEffect(() => {
    setLabels(loadLabels());
    const onChange = () => setLabels(loadLabels());
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const saveLabel = useCallback((vaultAddress: string, keyAddress: string, label: string) => {
    const next = loadLabels();
    const trimmed = label.trim().slice(0, MAX_LABEL_LENGTH);
    if (trimmed === "") delete next[labelKey(vaultAddress, keyAddress)];
    else next[labelKey(vaultAddress, keyAddress)] = trimmed;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode or a full store: labels just do not persist.
    }
    setLabels(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { labels, saveLabel };
}
