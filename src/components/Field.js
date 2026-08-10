export default function Field({ label, inputRef, ...props }) {
  return (
    <label className="mb-5 block">
      <span className="mb-2 block font-mono text-label uppercase text-chalk-soft">{label}</span>
      <input
        ref={inputRef}
        className="w-full border-0 border-b-2 border-edge bg-transparent px-0 py-1.5 font-mono text-lg text-chalk outline-none transition-colors placeholder:text-chalk-soft/60 focus:border-azure"
        {...props}
      />
    </label>
  );
}
