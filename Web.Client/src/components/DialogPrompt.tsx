import { useEffect, useState } from "react";
import type { AbilityPickerPayload, DialogPayload, GameClientMessage } from "../types/envelope";
import type { CardsView, CardView, GameView } from "../types/gameView";
import { getCombatSelection } from "../utils/combat";
import { stripHtmlTags } from "../utils/text";
import { CardTile } from "./CardTile";

interface DialogPromptProps {
  type: string;
  payload: DialogPayload;
  game: GameView | null;
  /** Mirrors the real Session API: exactly one of these five per response. */
  onRespond: (call: "send_uuid" | "send_boolean" | "send_integer" | "send_string" | "send_mana_type", args: unknown[]) => void;
  /** Reports hover in/out on any real card rendered here (a GAME_TARGET/GAME_SELECT
   * target, a GAME_PLAY_MANA tappable land) up to App's shared "hold Z to zoom"
   * overlay - without this, zoom only ever worked over Board's own cards, since
   * DialogPrompt is a sibling of Board, not a child, and had no way to reach it. */
  onHover?: (card: CardView | null) => void;
}

/** GAME_CHOOSE_CHOICE only gets a search box once it has more options than this - a
 * handful of colors/modes reads fine as plain buttons. */
const CHOICE_SEARCH_THRESHOLD = 8;

/** Label -> the matching key in PlayerView.manaPool (confirmed against a real payload -
 * lowercase color names, "colorless" instead of "Generic"). */
const MANA_TYPES: Array<[string, string]> = [
  ["White", "white"],
  ["Blue", "blue"],
  ["Black", "black"],
  ["Red", "red"],
  ["Green", "green"],
  ["Generic", "colorless"],
];

function isAbilityPicker(type: string, _payload: DialogPayload): _payload is AbilityPickerPayload {
  return type === "GAME_CHOOSE_ABILITY";
}

/** Best-effort card lookup for GAME_TARGET/GAME_SELECT's bare UUID lists. `cardsView1`
 * (when given - the current dialog's own payload) matters most for a "search your
 * library" target (fetch lands, tutors, ...): that's the searched zone itself, real
 * card data for exactly these ids and nowhere else (see GameClientMessage's doc
 * comment in types/envelope.ts) - checked first since it's the most specific match.
 * `revealed`/`lookedAt` cover a couple of other reveal-shaped effects. Without any of
 * this, every option in a search dialog fell back to a meaningless truncated id (and
 * no card art), which is exactly what made searching look broken. */
function findCard(game: GameView | null, id: string, cardsView1?: CardsView): CardView | null {
  if (cardsView1?.[id]) return cardsView1[id];
  if (!game) return null;
  const players = game.players ?? [];
  const pools: (CardsView | undefined)[] = [
    game.myHand,
    game.stack,
    ...players.map((p) => p.battlefield),
    ...players.map((p) => p.graveyard),
    ...(game.revealed ?? []).map((r) => r.cards),
    ...(game.lookedAt ?? []).map((r) => r.cards),
  ];
  for (const pool of pools) {
    if (pool?.[id]) return pool[id];
  }
  return null;
}

/** A target can be a player (e.g. "Select a starting player", "choose a player to
 * discard") just as often as a card - falls back to a truncated id if neither matches. */
function findCardName(game: GameView | null, id: string, cardsView1?: CardsView): string {
  const player = game?.players?.find((p) => p.playerId === id);
  if (player) return player.name;
  return findCard(game, id, cardsView1)?.name ?? id.slice(0, 8);
}

export function DialogPrompt({ type, payload, game, onRespond, onHover }: DialogPromptProps) {
  const [amount, setAmount] = useState("");
  // GAME_CHOOSE_CHOICE's list (e.g. Cavern of Souls' "choose a creature type") can run
  // into the hundreds of options - reset whenever a new question arrives (this
  // component stays mounted across different dialogs in sequence, so stale filter text
  // would otherwise silently carry over into the next, unrelated choice).
  const [choiceFilter, setChoiceFilter] = useState("");
  useEffect(() => setChoiceFilter(""), [payload]);
  const rawMessage = isAbilityPicker(type, payload) ? payload.message : (payload as GameClientMessage).message;
  const message = rawMessage ? stripHtmlTags(rawMessage) : rawMessage;

  // Keyboard shortcuts for the common cases - Enter for whichever button is the
  // "go ahead" action, Escape for "back out", A for the declare-attackers "All attack"
  // special button. GAME_GET_AMOUNT/GAME_GET_MULTI_AMOUNT already submit on Enter via
  // their native <form>, so they're left out here to avoid double-submitting.
  useEffect(() => {
    const gcm = payload as GameClientMessage;
    const combatSelection = type === "GAME_SELECT" ? getCombatSelection({ type, payload }) : null;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }
      if (isAbilityPicker(type, payload)) {
        return;
      }
      switch (type) {
        case "GAME_ASK":
          if (e.key === "Enter") onRespond("send_boolean", [true]);
          else if (e.key === "Escape") onRespond("send_boolean", [false]);
          break;
        case "GAME_TARGET":
          if (e.key === "Escape" && !gcm.flag) onRespond("send_boolean", [false]);
          break;
        case "GAME_SELECT":
          if (combatSelection) {
            if (e.key === "Enter") onRespond("send_boolean", [true]);
            else if ((e.key === "a" || e.key === "A") && combatSelection.allAttackButton) onRespond("send_string", ["special"]);
          } else if (e.key === "Escape" && !gcm.flag) {
            onRespond("send_boolean", [false]);
          }
          break;
        case "GAME_PLAY_MANA":
          if (e.key === "Escape") onRespond("send_boolean", [false]);
          break;
        case "GAME_PLAY_XMANA":
          if (e.key === "Enter") onRespond("send_boolean", [true]);
          else if (e.key === "Escape") onRespond("send_boolean", [false]);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [type, payload, onRespond]);

  return (
    <div className="dialog-prompt">
      <div className="dialog-type">{dialogTitle()}</div>
      {message && <div className="dialog-message">{message}</div>}
      <div className="dialog-options">{renderBody()}</div>
      {hotkeyHint() && <div className="dialog-hotkeys">{hotkeyHint()}</div>}
    </div>
  );

  /** A friendlier header than the raw envelope-type name, at least for the one dialog
   * that shows up constantly - the ordinary priority window (a bare GAME_SELECT with
   * no combat selection) isn't asking you to "select" anything most of the time, it's
   * just tracking whose turn/phase it is and whether you want to act before it moves
   * on. */
  function dialogTitle(): string {
    if (type === "GAME_SELECT") {
      const combatSelection = getCombatSelection({ type, payload });
      if (combatSelection) return combatSelection.kind === "attackers" ? "Declare Attackers" : "Declare Blockers";
      return "Turn Tracker";
    }
    return type;
  }

  function hotkeyHint(): string | null {
    if (isAbilityPicker(type, payload)) return null;
    const gcm = payload as GameClientMessage;
    switch (type) {
      case "GAME_ASK":
        return "Enter = Yes, Esc = No";
      case "GAME_TARGET":
        return !gcm.flag ? "Esc = Cancel" : null;
      case "GAME_SELECT": {
        const combatSelection = getCombatSelection({ type, payload });
        if (combatSelection) {
          return combatSelection.allAttackButton ? "Enter = Done, A = All attack" : "Enter = Done";
        }
        return !gcm.flag ? "Esc = Next phase / pass turn" : null;
      }
      case "GAME_PLAY_MANA":
        return "Esc = Cancel";
      case "GAME_PLAY_XMANA":
        return "Enter = Confirm, Esc = Cancel";
      default:
        return null;
    }
  }

  /** A target is a real card (library search results included, via findCard's
   * cardsView1/revealed/lookedAt lookup) as often as it's a player or something we
   * can't resolve at all - show actual card art when we can instead of a same-looking
   * text button for every option, which is exactly what made picking a card out of a
   * fetch land's search results unreadable. */
  function renderTargetOption(id: string, cardsView1?: CardsView) {
    const card = findCard(game, id, cardsView1);
    if (card) {
      return <CardTile key={id} card={card} onClick={() => onRespond("send_uuid", [id])} playable onHover={onHover} />;
    }
    return (
      <button key={id} onClick={() => onRespond("send_uuid", [id])}>
        {findCardName(game, id, cardsView1)}
      </button>
    );
  }

  /** GAME_TARGET's `targets` field is confirmed NULL for a "search your library"
   * target (TargetCardInLibrary: fetch lands, tutors, ...) - GameController.target
   * passes the Cards-event's own null `targets` straight through, and the real legal
   * ids only exist in options.possibleTargets for that case (see types/envelope.ts).
   * A plain permanent/player target populates `targets` directly instead and has no
   * possibleTargets at all, so preferring a non-empty `targets` first and falling back
   * to possibleTargets covers both shapes without needing to know which one this is. */
  function resolveTargetIds(gcm: GameClientMessage): string[] {
    if (gcm.targets && gcm.targets.length > 0) return gcm.targets;
    return gcm.options?.possibleTargets ?? [];
  }

  function renderBody() {
    if (isAbilityPicker(type, payload)) {
      return Object.entries(payload.choices).map(([id, label]) => (
        <button key={id} onClick={() => onRespond("send_uuid", [id])}>
          {label}
        </button>
      ));
    }

    const gcm = payload as GameClientMessage;

    switch (type) {
      case "GAME_ASK":
        return (
          <>
            <button onClick={() => onRespond("send_boolean", [true])}>Yes</button>
            <button onClick={() => onRespond("send_boolean", [false])}>No</button>
          </>
        );

      case "GAME_TARGET":
        return (
          <>
            {resolveTargetIds(gcm).map((id) => renderTargetOption(id, gcm.cardsView1))}
            {!gcm.flag && <button onClick={() => onRespond("send_boolean", [false])}>Cancel</button>}
          </>
        );

      case "GAME_SELECT": {
        // Declaring attackers/blockers is the same GAME_SELECT as an ordinary priority
        // window, distinguished only by an options.possibleAttackers/possibleBlockers
        // list (see utils/combat.ts) - when present, the actual creatures to pick are
        // clickable directly on the board (Board.tsx wires them via playableIds), so
        // this dialog just needs a way to confirm the selection, not a duplicate list
        // of buttons.
        const combatSelection = getCombatSelection({ type, payload });
        if (combatSelection) {
          return (
            <>
              {combatSelection.allAttackButton && (
                <button onClick={() => onRespond("send_string", ["special"])}>{combatSelection.allAttackButton}</button>
              )}
              <button onClick={() => onRespond("send_boolean", [true])}>Done</button>
            </>
          );
        }
        return (
          <>
            {resolveTargetIds(gcm).map((id) => renderTargetOption(id, gcm.cardsView1))}
            {/* This is the ordinary priority window (not a target/combat pick) - the
              * only "response" here is passing priority, which advances the phase/step
              * once everyone's passed, or ends the turn once there's nothing left to
              * advance to - "Cancel" never described what this button does. */}
            {!gcm.flag && <button onClick={() => onRespond("send_boolean", [false])}>Next Phase / Pass Turn</button>}
          </>
        );
      }

      case "GAME_CHOOSE_PILE":
        return (
          <>
            <button onClick={() => onRespond("send_boolean", [true])}>
              Pile 1 ({Object.keys(gcm.cardsView1 ?? {}).length} cards)
            </button>
            <button onClick={() => onRespond("send_boolean", [false])}>
              Pile 2 ({Object.keys(gcm.cardsView2 ?? {}).length} cards)
            </button>
          </>
        );

      case "GAME_CHOOSE_CHOICE": {
        const choice = gcm.choice;
        // [responseValue, displayLabel] - keyChoices sends the key back, a plain
        // choices list sends the value itself back (both via send_string).
        const entries: Array<[string, string]> = choice?.keyChoices
          ? Object.entries(choice.keyChoices)
          : (choice?.choices ?? []).map((value) => [value, value]);
        const needle = choiceFilter.trim().toLowerCase();
        const filtered = needle ? entries.filter(([, label]) => label.toLowerCase().includes(needle)) : entries;
        return (
          <>
            {/* A search box only earns its keep once scrolling/hunting is actually a
                problem (e.g. Cavern of Souls' ~300 creature types) - a 3-option color
                choice doesn't need one. */}
            {entries.length > CHOICE_SEARCH_THRESHOLD && (
              <input
                type="text"
                className="dialog-choice-search"
                placeholder="Search…"
                value={choiceFilter}
                onChange={(e) => setChoiceFilter(e.target.value)}
                autoFocus
              />
            )}
            {filtered.map(([key, label]) => (
              <button key={key} onClick={() => onRespond("send_string", [key])}>
                {label}
              </button>
            ))}
            {entries.length > 0 && filtered.length === 0 && <div className="dialog-choice-empty">No matches</div>}
          </>
        );
      }

      case "GAME_PLAY_MANA": {
        // Confirmed against a real payload: this is NOT "pick a color and we'll tap
        // something for you" - the real Session API has exactly three ways to answer
        // (HumanPlayer.playManaHandling): click the actual permanent you want to tap
        // (send_uuid), spend mana already floating in your pool (send_mana_type - only
        // meaningful for a color you actually have pooled, which is why this used to
        // show all six colors unconditionally and none of them did anything for most
        // players most of the time), or cancel. There's no "just parse a color" path.
        const me = game?.players?.find((p) => p.playerId === game.myPlayerId);
        const pool = me?.manaPool;
        const spendable = MANA_TYPES.filter(([, key]) => (pool?.[key] ?? 0) > 0);
        // The permanents actually legal to tap right now, straight from
        // canPlayObjects - listed directly in the dialog (not just left highlighted
        // out on the board, easy to miss among everything else there) since this is
        // exactly the moment the player needs to find and click one of them.
        const tappable = me
          ? Object.keys(game?.canPlayObjects?.objects ?? {})
              .map((id) => me.battlefield[id])
              .filter((card): card is CardView => Boolean(card))
          : [];
        return (
          <>
            <div className="dialog-hint">Click a permanent below (or on the board) to tap it for mana.</div>
            {tappable.length > 0 && (
              <div className="dialog-mana-sources">
                {tappable.map((card) => (
                  <CardTile key={card.id} card={card} onClick={() => onRespond("send_uuid", [card.id])} playable onHover={onHover} />
                ))}
              </div>
            )}
            {spendable.map(([label, key]) => (
              <button
                key={label}
                onClick={() => game?.myPlayerId && onRespond("send_mana_type", [game.myPlayerId, key.toUpperCase()])}
              >
                Spend {label} ({pool?.[key]})
              </button>
            ))}
            <button onClick={() => onRespond("send_boolean", [false])}>Cancel</button>
          </>
        );
      }

      case "GAME_PLAY_XMANA":
        return (
          <>
            <button onClick={() => onRespond("send_boolean", [true])}>Confirm</button>
            <button onClick={() => onRespond("send_boolean", [false])}>Cancel</button>
          </>
        );

      case "GAME_GET_AMOUNT":
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onRespond("send_integer", [Number(amount) || 0]);
            }}
          >
            <input
              type="number"
              value={amount}
              min={gcm.min}
              max={gcm.max}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            <button type="submit">OK</button>
            <button type="button" onClick={() => onRespond("send_boolean", [false])}>
              Cancel
            </button>
          </form>
        );

      case "GAME_GET_MULTI_AMOUNT":
        // Exact expected string format is unconfirmed (see envelope.ts) - comma-joined
        // is a best-effort guess pending a real payload to verify against.
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onRespond("send_string", [amount]);
            }}
          >
            {(gcm.messages ?? []).map((m, i) => (
              <div key={i}>{m.message}</div>
            ))}
            <input type="text" value={amount} placeholder="comma-separated amounts" onChange={(e) => setAmount(e.target.value)} />
            <button type="submit">OK</button>
          </form>
        );

      default:
        return <div className="dialog-unhandled">Unhandled dialog type - no response sent.</div>;
    }
  }
}
