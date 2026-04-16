export const CenteredHero = (props: {
  banner: React.ReactNode;
  title: React.ReactNode;
  description: string;
  buttons: React.ReactNode;
}) => (
  <>
    {props.banner && (
      <div className="mb-6 flex justify-center">{props.banner}</div>
    )}

    <h1 className="text-center text-4xl font-bold leading-[1.15] tracking-tight text-foreground sm:text-5xl md:text-6xl">
      {props.title}
    </h1>

    <p className="mx-auto mt-6 max-w-2xl text-center text-lg leading-relaxed text-muted-foreground sm:text-xl">
      {props.description}
    </p>

    <div className="mt-10 flex justify-center gap-3 max-sm:flex-col max-sm:items-stretch max-sm:px-4">
      {props.buttons}
    </div>
  </>
);
