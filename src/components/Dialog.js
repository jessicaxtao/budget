import { useEffect, useRef } from "react";

export default function Dialog({ show, handleClose, title, children }) {
  const dialogRef = useRef();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (show && !dialog.open) {
      dialog.showModal();
    } else if (!show && dialog.open) {
      dialog.close();
    }
  }, [show]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [handleClose]);

  function handleBackdropClick(e) {
    if (e.target === dialogRef.current) {
      dialogRef.current.close();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className="max-h-[85vh] w-full max-w-lg overflow-y-auto border border-edge bg-panel p-0 font-sans text-chalk shadow-2xl shadow-black/50 backdrop:bg-black/60"
    >
      <div className="p-6">
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-edge pb-4">
          <div className="font-sans text-lg font-semibold tracking-tight text-chalk">{title}</div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current.close()}
            className="flex h-7 w-7 shrink-0 items-center justify-center border border-edge text-base leading-none text-chalk-soft transition-colors hover:border-azure hover:text-azure"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
