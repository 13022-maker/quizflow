export const FeatureCard = (props: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-xl border bg-card p-6 transition-colors hover:border-primary/40">
    {/* 墨綠色 icon 方塊，配合主色系 */}
    <div className="size-11 rounded-lg bg-primary p-2.5 [&_svg]:size-full [&_svg]:stroke-primary-foreground [&_svg]:stroke-2">
      {props.icon}
    </div>

    <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
      {props.title}
    </h3>

    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
      {props.children}
    </p>
  </div>
);
