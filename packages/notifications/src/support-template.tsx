import { Body } from "@react-email/body";
import { Container } from "@react-email/container";
import { Head } from "@react-email/head";
import { Heading } from "@react-email/heading";
import { Html } from "@react-email/html";
import { Preview } from "@react-email/preview";
import { Text } from "@react-email/text";
import { render } from "@react-email/render";

export interface SupportEmailInput {
  ticketNumber: string;
  event: "created" | "reply" | "assigned" | "resolved" | "csat_request";
}

/** Only ticket metadata enters email; ticket bodies and internal notes stay in the portal. */
export async function renderSupportEmail(
  input: SupportEmailInput,
): Promise<{ html: string; text: string }> {
  const template = (
    <Html lang="en">
      <Head />
      <Preview>Support ticket {input.ticketNumber}</Preview>
      <Body style={{ fontFamily: "Arial, sans-serif", color: "#202020" }}>
        <Container>
          <Heading>Support ticket {input.ticketNumber}</Heading>
          <Text>Your support ticket has an update: {input.event}.</Text>
          <Text>Open your support portal to view the ticket.</Text>
        </Container>
      </Body>
    </Html>
  );
  return {
    html: await render(template),
    text: await render(template, { plainText: true }),
  };
}
