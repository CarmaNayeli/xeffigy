import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GameView } from "../types/gameView";
import { DialogPrompt } from "./DialogPrompt";

const noop = () => {};

describe("DialogPrompt", () => {
  it("renders GAME_ASK as Yes/No, responding with send_boolean", () => {
    const onRespond = vi.fn();
    render(<DialogPrompt type="GAME_ASK" payload={{ message: "Do you want to mulligan?" }} game={null} onRespond={onRespond} />);

    expect(screen.getByText("GAME_ASK")).toBeInTheDocument();
    expect(screen.getByText("Do you want to mulligan?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onRespond).toHaveBeenCalledWith("send_boolean", [true]);

    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onRespond).toHaveBeenCalledWith("send_boolean", [false]);
  });

  it("renders a resolvable GAME_TARGET target as real card art, clickable", () => {
    const onRespond = vi.fn();
    const game = {
      myHand: { "card-1": { id: "card-1", name: "Lightning Bolt" } },
    } as unknown as GameView;

    render(
      <DialogPrompt
        type="GAME_TARGET"
        payload={{ targets: ["card-1", "unknown-id"], flag: false }}
        game={game}
        onRespond={onRespond}
      />,
    );

    // A resolvable target renders as a real CardTile (not a button) - clicking the
    // card itself is the interaction, same as everywhere else on the board.
    fireEvent.click(screen.getByTitle("Lightning Bolt"));
    expect(onRespond).toHaveBeenCalledWith("send_uuid", ["card-1"]);

    // Unresolvable ids still render (as a plain button, truncated) rather than being
    // dropped - there's no card art to show for a target we can't find anywhere.
    expect(screen.getByRole("button", { name: "unknown-" })).toBeInTheDocument();
    // Not required (flag: false) - a Cancel option must be offered.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRespond).toHaveBeenCalledWith("send_boolean", [false]);
  });

  it("renders a library-search target (revealed/lookedAt) as real card art", () => {
    const onRespond = vi.fn();
    const game = {
      revealed: [{ name: "Search result", cards: { "land-1": { id: "land-1", name: "Plains" } } }],
    } as unknown as GameView;

    render(
      <DialogPrompt type="GAME_TARGET" payload={{ targets: ["land-1"], flag: true }} game={game} onRespond={onRespond} />,
    );

    fireEvent.click(screen.getByTitle("Plains"));
    expect(onRespond).toHaveBeenCalledWith("send_uuid", ["land-1"]);
  });

  it("falls back to options.possibleTargets when targets is null (real shape for a 'search your library' target, e.g. a fetch land) - and finds the card via cardsView1", () => {
    const onRespond = vi.fn();
    // Confirmed real shape (traced through GameController.target ->
    // GameSessionPlayer.target -> GameClientMessage's Cards-based constructor):
    // `targets` is always null for TargetCardInLibrary, and cardsView1 is the FULL,
    // unfiltered searched zone (here: the whole library) - only options.possibleTargets
    // says which of those are actually legal to pick. This is what fetch lands
    // (Marsh Flats, Bloodstained Mire, ...) and tutors go through.
    render(
      <DialogPrompt
        type="GAME_TARGET"
        payload={{
          message: "Search your library for a Plains or Swamp card",
          targets: null,
          flag: true,
          cardsView1: {
            "plains-1": { id: "plains-1", name: "Plains" },
            "island-1": { id: "island-1", name: "Island" },
          },
          options: { possibleTargets: ["plains-1"] },
        }}
        game={null}
        onRespond={onRespond}
      />,
    );

    // Only the legal one (Plains) renders - the Island sitting in the same searched
    // pool isn't a real option and must not appear at all.
    expect(screen.getByTitle("Plains")).toBeInTheDocument();
    expect(screen.queryByTitle("Island")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Plains"));
    expect(onRespond).toHaveBeenCalledWith("send_uuid", ["plains-1"]);
  });

  it("shows only Cancel when a library search finds no legal target at all (both targets and possibleTargets empty)", () => {
    render(
      <DialogPrompt
        type="GAME_TARGET"
        payload={{ message: "Search your library for a Plains or Swamp card", targets: null, flag: false, cardsView1: {} }}
        game={null}
        onRespond={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("resolves player-id targets (e.g. 'Select a starting player') to player names, not raw UUIDs", () => {
    const onRespond = vi.fn();
    const game = {
      players: [
        { playerId: "p1", name: "Carma", battlefield: {}, graveyard: {} },
        { playerId: "p2", name: "Practice Bot", battlefield: {}, graveyard: {} },
      ],
    } as unknown as GameView;

    render(
      <DialogPrompt
        type="GAME_TARGET"
        payload={{ message: "Select a starting player", targets: ["p1", "p2"], flag: true }}
        game={game}
        onRespond={onRespond}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Practice Bot" }));
    expect(onRespond).toHaveBeenCalledWith("send_uuid", ["p2"]);
  });

  it("omits Cancel for GAME_TARGET when the target is required", () => {
    render(<DialogPrompt type="GAME_TARGET" payload={{ targets: [], flag: true }} game={null} onRespond={noop} />);
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("renders declare-attackers GAME_SELECT as Done/All attack, not a target list", () => {
    const onRespond = vi.fn();
    render(
      <DialogPrompt
        type="GAME_SELECT"
        payload={{ message: "Select attackers", options: { possibleAttackers: ["c1", "c2"], specialButton: "All attack" } }}
        game={null}
        onRespond={onRespond}
      />,
    );

    expect(screen.getByText("Declare Attackers")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "c1" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All attack" }));
    expect(onRespond).toHaveBeenCalledWith("send_string", ["special"]);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onRespond).toHaveBeenCalledWith("send_boolean", [true]);
  });

  it("renders a plain priority window as 'Turn Tracker' with a Next Phase / Pass Turn button", () => {
    const onRespond = vi.fn();
    render(<DialogPrompt type="GAME_SELECT" payload={{ message: "Play spells and abilities", options: {} }} game={null} onRespond={onRespond} />);

    expect(screen.getByText("Turn Tracker")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next Phase / Pass Turn" }));
    expect(onRespond).toHaveBeenCalledWith("send_boolean", [false]);
  });

  it("responds to Enter/Escape for GAME_ASK", () => {
    const onRespond = vi.fn();
    render(<DialogPrompt type="GAME_ASK" payload={{ message: "Mulligan?" }} game={null} onRespond={onRespond} />);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onRespond).toHaveBeenCalledWith("send_boolean", [true]);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onRespond).toHaveBeenCalledWith("send_boolean", [false]);
  });

  it("renders GAME_CHOOSE_ABILITY's choices map, responding with send_uuid", () => {
    const onRespond = vi.fn();
    render(
      <DialogPrompt
        type="GAME_CHOOSE_ABILITY"
        payload={{ choices: { "ability-1": "Cast for 3 mana", "ability-2": "Cast for X" } }}
        game={null}
        onRespond={onRespond}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cast for X" }));
    expect(onRespond).toHaveBeenCalledWith("send_uuid", ["ability-2"]);
  });

  it("renders GAME_CHOOSE_CHOICE's keyChoices, responding with send_string", () => {
    const onRespond = vi.fn();
    render(
      <DialogPrompt
        type="GAME_CHOOSE_CHOICE"
        payload={{ choice: { keyChoices: { red: "Red", blue: "Blue" } } }}
        game={null}
        onRespond={onRespond}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    expect(onRespond).toHaveBeenCalledWith("send_string", ["blue"]);
  });

  it("doesn't show a search box for a small GAME_CHOOSE_CHOICE list", () => {
    render(
      <DialogPrompt
        type="GAME_CHOOSE_CHOICE"
        payload={{ choice: { keyChoices: { red: "Red", blue: "Blue" } } }}
        game={null}
        onRespond={noop}
      />,
    );
    expect(screen.queryByPlaceholderText("Search…")).not.toBeInTheDocument();
  });

  it("shows a search box and filters a large GAME_CHOOSE_CHOICE list (e.g. Cavern of Souls' creature types)", () => {
    const onRespond = vi.fn();
    const creatureTypes = ["Zombie", "Human", "Goblin", "Elf", "Merfolk", "Vampire", "Wurm", "Dragon", "Sliver"];
    render(
      <DialogPrompt
        type="GAME_CHOOSE_CHOICE"
        payload={{ choice: { choices: creatureTypes } }}
        game={null}
        onRespond={onRespond}
      />,
    );

    expect(creatureTypes.length).toBeGreaterThan(8); // above the search-box threshold
    creatureTypes.forEach((t) => expect(screen.getByRole("button", { name: t })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "zom" } });
    expect(screen.getByRole("button", { name: "Zombie" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Human" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zombie" }));
    expect(onRespond).toHaveBeenCalledWith("send_string", ["Zombie"]);
  });

  it("shows a 'No matches' message when the search filters out everything", () => {
    const creatureTypes = ["Zombie", "Human", "Goblin", "Elf", "Merfolk", "Vampire", "Wurm", "Dragon", "Sliver"];
    render(
      <DialogPrompt
        type="GAME_CHOOSE_CHOICE"
        payload={{ choice: { choices: creatureTypes } }}
        game={null}
        onRespond={noop}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "xyz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("renders GAME_GET_AMOUNT as a number form, responding with send_integer", () => {
    const onRespond = vi.fn();
    render(<DialogPrompt type="GAME_GET_AMOUNT" payload={{ min: 0, max: 5 }} game={null} onRespond={onRespond} />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onRespond).toHaveBeenCalledWith("send_integer", [3]);
  });

  it("strips the engine's Swing-style HTML tags out of the message text", () => {
    render(
      <DialogPrompt
        type="GAME_ASK"
        payload={{ message: "Mulligan <font color=#ffff00>down to 6 cards</font>?" }}
        game={null}
        onRespond={noop}
      />,
    );
    expect(screen.getByText("Mulligan down to 6 cards?")).toBeInTheDocument();
  });

  it("renders currently-tappable permanents as clickable card art in GAME_PLAY_MANA, responding with send_uuid", () => {
    const onRespond = vi.fn();
    const game = {
      myPlayerId: "p1",
      canPlayObjects: { objects: { "land-1": {} } },
      players: [
        {
          playerId: "p1",
          name: "Me",
          battlefield: { "land-1": { id: "land-1", name: "Forest", cardTypes: ["LAND"] } },
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      ],
    } as unknown as GameView;

    render(<DialogPrompt type="GAME_PLAY_MANA" payload={{ gameView: game }} game={game} onRespond={onRespond} />);

    fireEvent.click(screen.getByTitle("Forest"));
    expect(onRespond).toHaveBeenCalledWith("send_uuid", ["land-1"]);
  });

  it("spends pooled mana using the real ManaType key, not the display label (Generic must send COLORLESS)", () => {
    const onRespond = vi.fn();
    const game = {
      myPlayerId: "p1",
      canPlayObjects: { objects: {} },
      players: [
        {
          playerId: "p1",
          name: "Me",
          battlefield: {},
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 1 },
        },
      ],
    } as unknown as GameView;

    render(<DialogPrompt type="GAME_PLAY_MANA" payload={{ gameView: game }} game={game} onRespond={onRespond} />);

    fireEvent.click(screen.getByRole("button", { name: "Spend Generic (1)" }));
    expect(onRespond).toHaveBeenCalledWith("send_mana_type", ["p1", "COLORLESS"]);

    fireEvent.click(screen.getByRole("button", { name: "Spend Green (2)" }));
    expect(onRespond).toHaveBeenCalledWith("send_mana_type", ["p1", "GREEN"]);
  });

  it("renders an unhandled-type fallback without crashing or calling onRespond", () => {
    const onRespond = vi.fn();
    render(<DialogPrompt type="SOME_FUTURE_TYPE" payload={{}} game={null} onRespond={onRespond} />);
    expect(screen.getByText("SOME_FUTURE_TYPE")).toBeInTheDocument();
    expect(onRespond).not.toHaveBeenCalled();
  });
});
