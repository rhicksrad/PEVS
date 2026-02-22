const TEAMUP_HOST = 'https://ics.teamup.com';

type RequestLike = {
  query?: {
    calendarKey?: string | string[];
  };
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

function readCalendarKey(req: RequestLike): string | null {
  const raw = req.query?.calendarKey;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  const calendarKey = readCalendarKey(req);

  if (!calendarKey) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(400).send('Missing Teamup calendar key.');
    return;
  }

  const upstream = `${TEAMUP_HOST}/feed/${encodeURIComponent(calendarKey)}/0.ics`;
  const upstreamResponse = await fetch(upstream, {
    headers: {
      Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1'
    }
  });

  const body = await upstreamResponse.text();
  res.setHeader(
    'Content-Type',
    upstreamResponse.headers.get('content-type') ?? 'text/calendar; charset=utf-8'
  );
  res.status(upstreamResponse.status).send(body);
}
