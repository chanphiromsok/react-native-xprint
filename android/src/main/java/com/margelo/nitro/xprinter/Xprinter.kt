package com.margelo.nitro.xprinter
  
import com.facebook.proguard.annotations.DoNotStrip

@DoNotStrip
class Xprinter : HybridXprinterSpec() {
  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }
}
