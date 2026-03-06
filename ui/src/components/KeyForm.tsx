import { useState } from "react";

interface KeyFormProps {
  onSubmit: (payload: { name: string; model: string }) => Promise<void>;
}

export function KeyForm({ onSubmit }: KeyFormProps) {
  const [name, setName] = useState("");
  const [model, setModel] = useState("gpt-5-mini");

  return (
    <form
      className="key-form"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit({ name, model });
        setName("");
      }}
    >
      <div>
        <label htmlFor="name">Name</label>
        <input id="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer success team" required />
      </div>
      <div>
        <label htmlFor="model">Default Copilot Model</label>
        <input id="model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-5-mini" required />
      </div>
      <button type="submit">Create API Key</button>
    </form>
  );
}
