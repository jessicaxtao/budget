import { act, renderHook } from "@testing-library/react";
import useLocalStorage from "./useLocalStorage";

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

test("reads an existing value out of storage", () => {
  localStorage.setItem("k", JSON.stringify([1, 2, 3]));
  const { result } = renderHook(() => useLocalStorage("k", []));
  expect(result.current[0]).toEqual([1, 2, 3]);
});

test("falls back to the default when the key is absent", () => {
  const { result } = renderHook(() => useLocalStorage("k", ["fallback"]));
  expect(result.current[0]).toEqual(["fallback"]);
});

test("supports the lazy default-value form", () => {
  const { result } = renderHook(() => useLocalStorage("k", () => ({ made: "lazily" })));
  expect(result.current[0]).toEqual({ made: "lazily" });
});

test("persists updates, including the functional-updater form", () => {
  const { result } = renderHook(() => useLocalStorage("k", []));

  act(() => result.current[1](["first"]));
  expect(JSON.parse(localStorage.getItem("k"))).toEqual(["first"]);

  act(() => result.current[1]((prev) => [...prev, "second"]));
  expect(result.current[0]).toEqual(["first", "second"]);
  expect(JSON.parse(localStorage.getItem("k"))).toEqual(["first", "second"]);
});

describe("surviving bad storage", () => {
  test("corrupt JSON falls back to the default instead of throwing", () => {
    localStorage.setItem("k", "{not json at all");
    const { result } = renderHook(() => useLocalStorage("k", ["safe"]));
    expect(result.current[0]).toEqual(["safe"]);
  });

  test("the corrupt key is cleared so the failure does not repeat forever", () => {
    localStorage.setItem("k", "{not json at all");
    renderHook(() => useLocalStorage("k", ["safe"]));
    // re-seeded by the write effect rather than left in its unreadable state
    expect(JSON.parse(localStorage.getItem("k"))).toEqual(["safe"]);
  });

  test("a throwing getItem does not take down the render", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied");
    });
    const { result } = renderHook(() => useLocalStorage("k", ["safe"]));
    expect(result.current[0]).toEqual(["safe"]);
  });

  test("a throwing setItem does not take down the render", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const { result } = renderHook(() => useLocalStorage("k", []));
    act(() => result.current[1](["still works in memory"]));
    expect(result.current[0]).toEqual(["still works in memory"]);
  });
});

describe("cross-tab sync", () => {
  function writeFromAnotherTab(key, newValue) {
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue, storageArea: localStorage })
      );
    });
  }

  test("a write in another tab updates this one", () => {
    const { result } = renderHook(() => useLocalStorage("k", []));
    writeFromAnotherTab("k", JSON.stringify(["from the other tab"]));
    expect(result.current[0]).toEqual(["from the other tab"]);
  });

  test("a different key is ignored", () => {
    const { result } = renderHook(() => useLocalStorage("k", ["mine"]));
    writeFromAnotherTab("somethingElse", JSON.stringify(["not mine"]));
    expect(result.current[0]).toEqual(["mine"]);
  });

  test("clearing the key in another tab restores the default", () => {
    localStorage.setItem("k", JSON.stringify(["present"]));
    const { result } = renderHook(() => useLocalStorage("k", ["default"]));
    expect(result.current[0]).toEqual(["present"]);

    writeFromAnotherTab("k", null);
    expect(result.current[0]).toEqual(["default"]);
  });

  test("unreadable data from another tab leaves the current value alone", () => {
    const { result } = renderHook(() => useLocalStorage("k", ["mine"]));
    writeFromAnotherTab("k", "{garbage");
    expect(result.current[0]).toEqual(["mine"]);
  });

  test("the listener is removed on unmount", () => {
    const remove = jest.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useLocalStorage("k", []));
    unmount();
    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));
  });
});

describe("migration", () => {
  test("migrate runs on values read from storage", () => {
    localStorage.setItem("k", JSON.stringify([{ amount: 5 }]));
    const migrate = (records) => records.map((r) => ({ amountCents: r.amount * 100 }));
    const { result } = renderHook(() => useLocalStorage("k", [], migrate));
    expect(result.current[0]).toEqual([{ amountCents: 500 }]);
  });

  test("migrate does not run on the default value", () => {
    const migrate = jest.fn((v) => v);
    renderHook(() => useLocalStorage("k", ["untouched"], migrate));
    expect(migrate).not.toHaveBeenCalled();
  });

  test("a migration that throws falls back to the default rather than crashing", () => {
    localStorage.setItem("k", JSON.stringify([{ shape: "unexpected" }]));
    const migrate = () => {
      throw new TypeError("cannot read property of undefined");
    };
    const { result } = renderHook(() => useLocalStorage("k", ["safe"], migrate));
    expect(result.current[0]).toEqual(["safe"]);
  });
});
