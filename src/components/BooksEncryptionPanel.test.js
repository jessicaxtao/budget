import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BooksEncryptionPanel from "./BooksEncryptionPanel";
import { SyncContext } from "../contexts/SyncContext";
import {
  IDENTITY_STATUS,
  IdentityKeyContext,
  MIN_BOOKS_PASSWORD_LENGTH,
} from "../contexts/IdentityKeyContext";

/**
 * This is the panel's own contract, not the key's — the round trip through a
 * real server and a real master key is `IdentityKeyContext.test.js`'s job. What
 * is pinned here is what this component does with whatever that context
 * reports: both halves of what the server can see, a refused password
 * change surfaced rather than swallowed, a regenerated recovery code shown
 * once, and the component going inert rather than throwing when there is no
 * `IdentityKeyProvider` above it — the exact shape every page suite renders in.
 *
 * **Both contexts are staged through their real `Provider`, and nothing here
 * mocks a hook** — `TESTING.md`'s rule, and this suite is why both context
 * objects are exported: a panel reading its context through a jest mock would
 * go on passing while the provider's actual shape drifted out from under it,
 * which is the failure that rule exists to prevent. `BooksFilePanel.test.js`
 * stages `SyncContext` the same way.
 */
function renderPanel({ remote = true, booksKey } = {}) {
  // No `SyncProvider` and no `IdentityKeyProvider`: the shape every page suite
  // and `App.test.js`'s route sweep render the page in.
  const tree =
    remote === undefined ? (
      <BooksEncryptionPanel />
    ) : (
      <SyncContext.Provider value={{ remote }}>
        <BooksEncryptionPanel />
      </SyncContext.Provider>
    );

  // `undefined` deliberately goes through the provider as well, so the "no key
  // context" case is the real `useContext` answer rather than a staged one.
  return render(
    booksKey === undefined ? (
      tree
    ) : (
      <IdentityKeyContext.Provider value={booksKey}>{tree}</IdentityKeyContext.Provider>
    )
  );
}

async function open() {
  await userEvent.click(screen.getByText("Encryption"));
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("with no key context above it", () => {
  test("renders nothing rather than throwing", () => {
    const { container } = renderPanel({ remote: true, booksKey: undefined });
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing with no SyncProvider either", () => {
    const { container } = renderPanel({ remote: undefined, booksKey: undefined });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("on a build with no account server", () => {
  test("renders nothing even once a key context exists", () => {
    // `remote` false is the unconfigured-build and local-only shape:
    // `IdentityKeyContext` reports `unlocked` immediately there too, since there
    // is nothing to lock — so the panel has to read `remote` itself rather
    // than trust `status` alone, or it would describe a server that is not
    // in the picture.
    const { container } = renderPanel({
      remote: false,
      booksKey: { status: IDENTITY_STATUS.UNLOCKED, changePassword: jest.fn(), regenerateRecoveryCode: jest.fn() },
    });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("what the server can and cannot see", () => {
  test("states both halves", async () => {
    renderPanel({
      booksKey: { status: IDENTITY_STATUS.UNLOCKED, changePassword: jest.fn(), regenerateRecoveryCode: jest.fn() },
    });
    await open();

    expect(screen.getByText("can", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("cannot", { selector: "strong" })).toBeInTheDocument();
    // The reassuring half and the honest half, named rather than only implied.
    expect(screen.getByText(/sign-in times/i)).toBeInTheDocument();
    expect(screen.getByText(/any figure, name, date or category/i)).toBeInTheDocument();
    expect(screen.getByText(/document sizes, file sizes and update times still leak/i)).toBeInTheDocument();
  });
});

describe("when the key was set up", () => {
  /**
   * `created_at` is a `timestamptz` — a real instant, not a calendar date — so
   * the panel parses it rather than slicing ten characters off the front. The
   * instant chosen here is late enough in UTC that the two readings fall on
   * **different days**, which is what makes this assert the conversion instead
   * of agreeing with either answer by luck.
   */
  test("is read as a local day, not a sliced UTC one", async () => {
    renderPanel({
      booksKey: {
        status: IDENTITY_STATUS.UNLOCKED,
        createdAt: "2026-03-01T03:30:00.000Z",
        changePassword: jest.fn(),
        regenerateRecoveryCode: jest.fn(),
      },
    });
    await open();

    const expected = new Date("2026-03-01T03:30:00.000Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    const term = screen.getByText("Key set up");
    expect(term.nextElementSibling).toHaveTextContent(expected);
  });

  // Nothing is invented: a row with no date shows no line rather than a
  // placeholder or today's date.
  test("is absent rather than guessed when the row carries no date", async () => {
    renderPanel({
      booksKey: {
        status: IDENTITY_STATUS.UNLOCKED,
        createdAt: null,
        changePassword: jest.fn(),
        regenerateRecoveryCode: jest.fn(),
      },
    });
    await open();

    expect(screen.queryByText("Key set up")).not.toBeInTheDocument();
  });
});

describe("changing the books password", () => {
  function setup(changePassword) {
    renderPanel({
      booksKey: { status: IDENTITY_STATUS.UNLOCKED, changePassword, regenerateRecoveryCode: jest.fn() },
    });
  }

  test("surfaces a refusal rather than reporting success", async () => {
    const changePassword = jest.fn().mockResolvedValue({ ok: false, error: "That password could not be used." });
    setup(changePassword);
    await open();

    const password = `a${MIN_BOOKS_PASSWORD_LENGTH}characterslong`;
    await userEvent.type(screen.getByLabelText("New books password"), password);
    await userEvent.type(screen.getByLabelText("Confirm new books password"), password);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That password could not be used.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(changePassword).toHaveBeenCalledWith(password);
  });

  test("does not call the mutator when the two fields disagree", async () => {
    const changePassword = jest.fn();
    setup(changePassword);
    await open();

    await userEvent.type(screen.getByLabelText("New books password"), "aaaaaaaaaaaa");
    await userEvent.type(screen.getByLabelText("Confirm new books password"), "bbbbbbbbbbbb");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/do not match/i);
    expect(changePassword).not.toHaveBeenCalled();
  });

  test("reports success only once the mutator actually agrees", async () => {
    const changePassword = jest.fn().mockResolvedValue({ ok: true });
    setup(changePassword);
    await open();

    const password = "a-perfectly-long-books-password";
    await userEvent.type(screen.getByLabelText("New books password"), password);
    await userEvent.type(screen.getByLabelText("Confirm new books password"), password);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/password was changed/i);
  });
});

describe("the \"needs unlocked\" controls", () => {
  test("are not offered while the books are only locked", async () => {
    renderPanel({
      booksKey: { status: IDENTITY_STATUS.LOCKED, changePassword: jest.fn(), regenerateRecoveryCode: jest.fn() },
    });
    await open();

    expect(screen.queryByLabelText("New books password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /regenerate recovery code/i })).not.toBeInTheDocument();
    expect(screen.getByText(/unlock your books/i)).toBeInTheDocument();
  });
});

describe("regenerating the recovery code", () => {
  test("shows the new code once, with the save confirmation BooksKeyGate uses", async () => {
    const regenerateRecoveryCode = jest
      .fn()
      .mockResolvedValue({ ok: true, recoveryCode: "ABCD-EFGH-JKMN-PQRS-TVWX-YZ23-4567-89AB" });
    renderPanel({
      booksKey: {
        status: IDENTITY_STATUS.UNLOCKED,
        changePassword: jest.fn(),
        regenerateRecoveryCode,
      },
    });
    await open();

    await userEvent.click(screen.getByRole("button", { name: /regenerate recovery code/i }));

    const code = await screen.findByText("ABCD-EFGH-JKMN-PQRS-TVWX-YZ23-4567-89AB");
    expect(code).toBeInTheDocument();

    const doneButton = screen.getByRole("button", { name: "Done" });
    expect(doneButton).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox"));
    expect(doneButton).toBeEnabled();

    await userEvent.click(doneButton);

    // Shown once: confirming it takes the code off the screen, back to the
    // button that would mint another.
    expect(screen.queryByText("ABCD-EFGH-JKMN-PQRS-TVWX-YZ23-4567-89AB")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /regenerate recovery code/i })).toBeInTheDocument();
  });

  test("surfaces a refusal rather than showing a code that was never minted", async () => {
    const regenerateRecoveryCode = jest.fn().mockResolvedValue({ ok: false, error: "Unlock your books first." });
    renderPanel({
      booksKey: {
        status: IDENTITY_STATUS.UNLOCKED,
        changePassword: jest.fn(),
        regenerateRecoveryCode,
      },
    });
    await open();

    await userEvent.click(screen.getByRole("button", { name: /regenerate recovery code/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unlock your books first.");
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });
});
