export const TitleBar = (props: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode; // 可選：右側行動按鈕或連結
}) => (
  <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div className="w-full min-w-0 sm:flex-1">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{props.title}</h1>
      {props.description && (
        <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>
      )}
    </div>
    {props.action && <div className="shrink-0">{props.action}</div>}
  </div>
);
