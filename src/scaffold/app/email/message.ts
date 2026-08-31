/**
 * One outgoing email, as every template returns
 * it and the mailer accepts it. `headers` is
 * absent unless the message needs the one-click
 * unsubscribe pair, which only a bulk send does.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
};
