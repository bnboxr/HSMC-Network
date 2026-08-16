package com.hsmc.wallet.core

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/**
 * Real QR rendering backed by the ZXing core library (com.google.zxing:core).
 *
 * Renders the ZXing BitMatrix to an Android [Bitmap] with a quiet-zone margin; the
 * QR content is whatever string is passed in (the HSMC address for Receive).
 */
object QrCode {

    /** Renders [content] as a square QR [Bitmap] with [size] pixels per side. */
    fun render(content: String, size: Int, marginPx: Int = 8): Bitmap {
        require(size > 0) { "size must be positive" }
        val writer = QRCodeWriter()
        val matrix = writer.encode(content, BarcodeFormat.QR_CODE, size, size, mapOf(
            com.google.zxing.EncodeHintType.MARGIN to marginPx,
            com.google.zxing.EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M
        ))
        val bitmap = Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888)
        for (x in 0 until matrix.width) {
            for (y in 0 until matrix.height) {
                bitmap.setPixel(x, y, if (matrix.get(x, y)) Color.BLACK else Color.WHITE)
            }
        }
        return bitmap
    }

    /** Renders [content] scaled to fill exactly [size]x[size] pixels. */
    fun renderScaled(content: String, size: Int): Bitmap =
        Bitmap.createScaledBitmap(render(content, size), size, size, true)
}
