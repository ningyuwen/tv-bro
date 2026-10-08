package com.phlox.tvwebbrowser.activity.main.dialogs.settings

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.text.Html
import android.util.AttributeSet
import android.view.LayoutInflater
import android.widget.ScrollView
import com.phlox.tvwebbrowser.BuildConfig
import com.phlox.tvwebbrowser.R
import com.phlox.tvwebbrowser.activity.IncognitoModeMainActivity
import com.phlox.tvwebbrowser.activity.main.MainActivity
import com.phlox.tvwebbrowser.activity.main.SettingsModel
import com.phlox.tvwebbrowser.databinding.ViewSettingsVersionBinding
import com.phlox.tvwebbrowser.utils.activemodel.ActiveModelsRepository
import com.phlox.tvwebbrowser.utils.activity
import com.phlox.tvwebbrowser.webengine.WebEngineFactory
import androidx.core.net.toUri

@SuppressLint("SetTextI18n")
class VersionSettingsView @JvmOverloads constructor(
        context: Context, attrs: AttributeSet? = null, defStyleAttr: Int = 0
) : ScrollView(context, attrs, defStyleAttr) {

    companion object {
        private const val URL_SUPPORT_AUTHOR = "https://donatello.to/truefedex"
        private const val URL_LICENSE =
            "https://raw.githubusercontent.com/truefedex/tv-bro/refs/heads/master/LICENSE.md"
        private const val URL_PRIVACY_POLICY =
            "https://raw.githubusercontent.com/truefedex/tv-bro/refs/heads/master/PRIVACY.md"
    }
    private var vb = ViewSettingsVersionBinding.inflate(LayoutInflater.from(getContext()), this, true)
    var settingsModel = ActiveModelsRepository.get(SettingsModel::class, activity!!)
    var callback: Callback? = null

    interface Callback {
        fun onNeedToCloseSettings()
    }

    init {
        vb.tvDescription.text = context.getString(R.string.source_attribution)
        vb.tvVersion.text = context.getString(R.string.version_s, BuildConfig.VERSION_NAME)

        vb.tvBuildFlavor.text = context.getString(
            R.string.build_flavor_s,
            BuildConfig.FLAVOR
        )

        val engineVersion = "Engine: " + WebEngineFactory.getWebEngineVersionString()
        vb.tvWebViewVersion.text = engineVersion

        vb.tvLink.text = Html.fromHtml("<p><u>https://github.com/truefedex/tv-bro</u></p>",
            Html.FROM_HTML_MODE_LEGACY)
        vb.tvLink.setOnClickListener {
            loadUrl(vb.tvLink.text.toString())
        }

        vb.tvSupportAuthor.text = context.getString(R.string.support_the_author)
        vb.tvSupportAuthor.setOnClickListener {
            loadUrl(URL_SUPPORT_AUTHOR)
        }

        vb.tvLicense.text = context.getString(R.string.view_license)
        vb.tvLicense.setOnClickListener {
            loadUrl(URL_LICENSE)
        }

        vb.tvPrivacy.text = context.getString(R.string.privacy_policy)
        vb.tvPrivacy.setOnClickListener {
            loadUrl(URL_PRIVACY_POLICY)
        }

        vb.tvUkraine.setOnClickListener {
            loadUrl("https://tv-bro-3546c.web.app/msg001.html")
        }
    }

    private fun loadUrl(url: String) {
        callback?.onNeedToCloseSettings()
        val activityClass = if (settingsModel.config.incognitoMode)
            IncognitoModeMainActivity::class.java else MainActivity::class.java
        val intent = Intent(activity, activityClass)
        intent.data = url.toUri()
        activity?.startActivity(intent)
    }

}
