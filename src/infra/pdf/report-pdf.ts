import { type Readable } from 'node:stream';

import PDFDocument from 'pdfkit';

import { formatUsd } from '../../shared/money.js';

export interface ReportParty {
  name: string;
  email: string;
}

export interface ReportAddress {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface ReportJob {
  id: string;
  description: string;
  status: string;
  costCents: number;
  location: ReportAddress;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ReportMessage {
  createdAt: Date;
  senderName: string;
  body: string;
}

export interface ReportDocument {
  generatedAt: Date;
  job: ReportJob;
  contractor: ReportParty;
  homeowners: ReportParty[];
  messages: AsyncIterable<ReportMessage>;
}

export interface ReportWriter {
  write(report: ReportDocument): Readable;
}

const MUTED = '#555555';
const INK = '#000000';

export class PdfKitReportWriter implements ReportWriter {
  write(report: ReportDocument): Readable {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: `Project report ${report.job.id}`, Author: 'Renovation Project Tracker' },
    });
    void this.render(doc, report).catch((error: unknown) => {
      doc.destroy(error instanceof Error ? error : new Error(String(error)));
    });
    return doc;
  }

  private async render(doc: PDFKit.PDFDocument, report: ReportDocument): Promise<void> {
    doc.fontSize(20).fillColor(INK).text('Project report');
    doc
      .fontSize(10)
      .fillColor(MUTED)
      .text(`Job ${report.job.id}`)
      .text(`Generated ${report.generatedAt.toISOString()}`);

    this.section(doc, 'Job');
    this.keyValue(doc, 'Description', report.job.description);
    this.keyValue(doc, 'Status', report.job.status);
    this.keyValue(doc, 'Cost', formatUsd(report.job.costCents));
    this.keyValue(doc, 'Address', formatAddress(report.job.location));
    this.keyValue(doc, 'Created', report.job.createdAt.toISOString());
    this.keyValue(doc, 'Last updated', report.job.updatedAt.toISOString());
    if (report.job.deletedAt) {
      this.keyValue(doc, 'Deleted', report.job.deletedAt.toISOString());
    }

    this.section(doc, 'People');
    this.keyValue(doc, 'Contractor', `${report.contractor.name} <${report.contractor.email}>`);
    if (report.homeowners.length === 0) {
      this.keyValue(doc, 'Homeowners', 'None yet');
    }
    for (const homeowner of report.homeowners) {
      this.keyValue(doc, 'Homeowner', `${homeowner.name} <${homeowner.email}>`);
    }

    this.section(doc, 'Messages');
    let count = 0;
    for await (const message of report.messages) {
      count += 1;
      doc
        .fontSize(9)
        .fillColor(MUTED)
        .text(`${message.createdAt.toISOString()}  ${message.senderName}`);
      doc.fontSize(10).fillColor(INK).text(message.body, { indent: 12 });
      doc.moveDown(0.4);
    }
    if (count === 0) {
      doc.fontSize(10).fillColor(INK).text('No messages yet.');
    }
    doc.moveDown();
    doc
      .fontSize(9)
      .fillColor(MUTED)
      .text(`${count} message${count === 1 ? '' : 's'} in total.`);

    doc.end();
  }

  private section(doc: PDFKit.PDFDocument, title: string): void {
    doc.moveDown(1.2);
    doc.fontSize(14).fillColor(INK).text(title);
    doc.moveDown(0.4);
  }

  private keyValue(doc: PDFKit.PDFDocument, key: string, value: string): void {
    doc.fontSize(10).fillColor(MUTED).text(`${key}: `, { continued: true });
    doc.fillColor(INK).text(value);
  }
}

function formatAddress(address: ReportAddress): string {
  return [
    address.addressLine1,
    address.addressLine2,
    `${address.city}, ${address.state} ${address.postalCode}`,
    address.country,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}
