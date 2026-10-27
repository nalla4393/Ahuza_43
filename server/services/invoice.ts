import PDFDocument from 'pdfkit';
import type { Order } from './database.js';

export async function buildInvoicePdf(order: Order, customerEmail: string): Promise<Buffer> {
  const document = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  const safePdfText = (value: string) => value.normalize('NFKD').replace(/[^\x20-\x7e]/g, '?');

  const pdf = new Promise<Buffer>((resolve, reject) => {
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  document.fontSize(22).font('Helvetica-Bold').text('AHUZA APPAREL');
  document.moveDown(0.5).fontSize(18).text('INVOICE & PAYMENT RECEIPT');
  document.moveDown(0.5).fontSize(10).font('Helvetica')
    .text(`Invoice / order reference: ${order.id}`)
    .text(`Order date: ${new Date(order.createdAt).toLocaleDateString('en-IN')}`)
    .text(`Payment status: ${order.paymentStatus}`)
    .text(`Payment method: ${order.paymentMethod === 'cod' ? 'Cash on delivery' : 'UPI'}`)
    .text(`Payment reference: ${order.manualPaymentReference || order.paymentReference || order.id}`)
    .text(`Payment confirmed: ${order.paymentVerifiedAt ? new Date(order.paymentVerifiedAt).toLocaleDateString('en-IN') : 'Not available'}`);
  document.moveDown().font('Helvetica-Bold').text('Bill to');
  document.font('Helvetica')
    .text(safePdfText(order.shippingAddress.name))
    .text(safePdfText(order.shippingAddress.addressLine1))
    .text(safePdfText(order.shippingAddress.addressLine2 || ''))
    .text(safePdfText(`${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}`))
    .text(order.shippingAddress.country)
    .text(`Email: ${safePdfText(customerEmail)}`);
  document.moveDown().font('Helvetica-Bold').text('Items');
  document.moveDown(0.4);
  for (const item of order.items) {
    const lineTotal = item.unitPrice * item.quantity;
    document.font('Helvetica-Bold').text(safePdfText(`${item.name}${item.size ? ` - Size ${item.size}` : ''}`));
    document.font('Helvetica').fontSize(9).text(`SKU: ${safePdfText(item.sku)}  |  Quantity: ${item.quantity}  |  Unit price: INR ${item.unitPrice.toFixed(2)}  |  Line total: INR ${lineTotal.toFixed(2)}`);
    document.moveDown(0.6);
  }
  document.moveDown().fontSize(12).font('Helvetica-Bold').text(`Total paid: ${order.currency} ${(order.amount / 100).toFixed(2)}`, { align: 'right' });
  document.moveDown(2).fontSize(9).font('Helvetica').text('Thank you for shopping with AHUZA Apparel');
  document.end();

  return pdf;
}
