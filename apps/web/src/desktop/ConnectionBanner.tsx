type ConnectionStatus = "connecting" | "connected" | "unhealthy";

interface Props {
  status: ConnectionStatus;
}

export default function ConnectionBanner({ status }: Props) {
  if (status === "connected") {
    return null;
  }

  const isUnhealthy = status === "unhealthy";

  return (
    <div
      className={`connection-banner ${isUnhealthy ? "is-unhealthy" : "is-connecting"}`}
      role="alert"
    >
      <span className="connection-banner-dot" />
      <span className="connection-banner-text">
        {isUnhealthy
          ? "后端服务不可用，请重启 Lapras"
          : "正在尝试连接后端服务…"}
      </span>
    </div>
  );
}
