"use client";

/**
 * Kakao 주소 자동완성 입력 — project/new 주소 검색용.
 * 2글자 이상 · 300ms 디바운스 · 키보드 ↑↓ Enter · 클릭 선택.
 * 드롭다운은 portal로 렌더 — Panel overflow:hidden 에서 잘리지 않음.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

export interface AddressSuggestionItem {
  address: string;
  roadAddress: string | null;
  sido: string;
  sigungu: string;
  dong: string;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (item: AddressSuggestionItem) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  onSubmit,
  disabled = false,
  placeholder = "예: 서울 도봉구 쌍문동 281-23",
}: AddressAutocompleteProps) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestionItem[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateMenuPosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const preferBelow = spaceBelow >= 120 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(280, preferBelow ? spaceBelow : spaceAbove);

    setMenuStyle({
      position: "fixed",
      left: r.left,
      width: r.width,
      zIndex: 10_000,
      maxHeight: Math.max(120, maxHeight),
      ...(preferBelow
        ? { top: r.bottom + 4 }
        : { bottom: window.innerHeight - r.top + 4 }),
    });
  }, []);

  const fetchSuggestions = useCallback(async (query: string) => {
    abortRef.current?.abort();
    if (query.trim().length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);

    try {
      const res = await fetch(
        `/api/parcels/address-suggest?q=${encodeURIComponent(query.trim())}`,
        { signal: ac.signal }
      );
      if (!res.ok) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      const data = (await res.json()) as {
        suggestions?: AddressSuggestionItem[];
      };
      const items = data.suggestions ?? [];
      setSuggestions(items);
      setOpen(items.length > 0);
      setHighlight(items.length > 0 ? 0 : -1);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setSuggestions([]);
        setOpen(false);
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (disabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, disabled, fetchSuggestions]);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onReflow = () => updateMenuPosition();
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, suggestions.length, updateMenuPosition]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (item: AddressSuggestionItem) => {
    onChange(item.address);
    onSelect?.(item);
    setOpen(false);
    setSuggestions([]);
    setHighlight(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (!open || suggestions.length === 0) return;
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
      return;
    }
    if (e.key === "ArrowUp") {
      if (!open || suggestions.length === 0) return;
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
      return;
    }
    if (e.key === "Enter") {
      if (open && highlight >= 0 && suggestions[highlight]) {
        e.preventDefault();
        pick(suggestions[highlight]);
        return;
      }
      setOpen(false);
      onSubmit?.();
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    }
  };

  const dropdown =
    open && suggestions.length > 0 && menuStyle ? (
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        style={{
          ...menuStyle,
          margin: 0,
          padding: 4,
          listStyle: "none",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
          overflowY: "auto",
        }}
      >
        {suggestions.map((item, i) => (
          <li
            key={`${item.address}-${i}`}
            id={`${listId}-opt-${i}`}
            role="option"
            aria-selected={i === highlight}
            onMouseEnter={() => setHighlight(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(item)}
            style={{
              padding: "8px 10px",
              borderRadius: 4,
              cursor: "pointer",
              background:
                i === highlight ? "var(--accent-soft)" : "transparent",
            }}
          >
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                color: "var(--fg)",
                lineHeight: 1.35,
              }}
            >
              {item.address}
            </div>
            {item.roadAddress && item.roadAddress !== item.address && (
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--fg-muted)",
                  marginTop: 2,
                }}
              >
                도로명 · {item.roadAddress}
              </div>
            )}
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          highlight >= 0 ? `${listId}-opt-${highlight}` : undefined
        }
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (e.target.value.trim().length >= MIN_QUERY_LEN) setOpen(true);
        }}
        onFocus={() => {
          if (suggestions.length > 0) {
            setOpen(true);
            updateMenuPosition();
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        style={{
          width: "100%",
          height: 36,
          padding: "0 12px",
          paddingRight: loading ? 32 : 12,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 5,
          fontSize: 14,
          color: "var(--fg)",
          fontFamily: "inherit",
        }}
      />
      {loading && (
        <span
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 11,
            color: "var(--fg-faint)",
          }}
        >
          …
        </span>
      )}
      {mounted && dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}
