interface SearchFieldProps {
  query: string;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange(query: string): void;
}

export function SearchField({ query, placeholder, inputRef, onQueryChange }: SearchFieldProps) {
  return (
    <form className="service-search" role="search" onSubmit={(event) => event.preventDefault()}>
      <label className="visually-hidden" htmlFor="service-search-input">
        {placeholder}
      </label>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <input
        id="service-search-input"
        ref={inputRef}
        type="search"
        value={query}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-keyshortcuts="/"
        autoComplete="off"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <kbd aria-hidden="true">/</kbd>
    </form>
  );
}
