import { QRCodeSVG } from 'qrcode.react';

export default function PaymentQr({ payUrl }: { payUrl: string }) {
  return <div className="payment-qr">
    <QRCodeSVG value={payUrl} size={224} marginSize={4} level="M" role="img" aria-label="UPI payment QR code" />
    <p>Scan with your UPI app on another device. Check the recipient and amount before paying.</p>
  </div>;
}
