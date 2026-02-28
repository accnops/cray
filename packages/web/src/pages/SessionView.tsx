import { useParams } from "react-router-dom";

export function SessionView() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="session-view">
      <h2>Session View</h2>
      <p>Viewing session: {id}</p>
    </div>
  );
}
