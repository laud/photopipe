var path = require('path')
  , request = require('request')
  , fs = require('fs')
  , qs = require('querystring')

/****************************************************************

Plugins...

****************************************************************/

var Instagram = require(path.resolve(__dirname, '..', 'plugins/instagram/instagram.js')).Instagram
var Facebook = require(path.resolve(__dirname, '..', 'plugins/facebook/facebook.js')).Facebook


/****************************************************************

Actual Routes...

****************************************************************/

/*
 * GET home page.
 */

exports.index = function(req, res){
  res.render('index', { title: 'PhotoPipe - Put Your Image URL In and Smoke It!'})
}

/*
 * POST inbound photo url.

  -- API Interface --
  Post body can/should contain:

  photoUrl (required)     An URL to an image
  timeToDie (optional)    A numerical value in seconds of how long the image remains on disk.
  
*/
 
exports.smoke = function(req, res){
  // Check for a mufkcn photo url...
  if(!req.body.photoUrl) return res.json({error: true, message: "No photo URL in yer POST, brah."})

  // Echo back all the things.
  var echo = {}
  
  // http://bit.ly/node-path-resolve
  // http://bit.ly/node-path-join
  echo.photoDirPath = path.resolve(__dirname, '..', path.join('public','outbound'))
  echo.photoUrl = req.body.photoUrl

  // http://bit.ly/node-path-basename
  echo.photoName = path.basename(req.body.photoUrl)
    
  // Verify it's a mufckn image (png, jpg, etc.)
  if( !(/\.(?=gif|jpg|jpeg|png|bmp)/gi).test(echo.photoName) ){
    echo.hasError = true
    echo.message = "Looks like the url "+echo.photoUrl+" is not an image, breaux."
    return res.json(echo)
  }
  
  echo.fullPhotoPath = path.join(echo.photoDirPath, echo.photoName)
  
  // http://bit.ly/node-createWriteStream 
  var ws = fs.createWriteStream( echo.fullPhotoPath ) 

  // Let's put the shit in our pipe and smoke it! Err, write it to a file.
  request(echo.photoUrl).pipe( ws )

  // http://bit.ly/node-stream-on-error
  ws.on('error', function(exception){
    echo.hasError = true
    echo.errorMessage = exception
    return res.json(echo)
  }) // end ws.error()  

  // http://bit.ly/node-stream-on-close
  ws.on('close', function(){
    // Check to see it was written.
    fs.exists(echo.fullPhotoPath, function (exists) {
      
      if(!exists){
        echo.hasError = true
        echo.errorMessage = "Unable to verify your photo " + echo.photoName + " was written to disk, brochacho."
      }
      // So now we just echo it back. Ideally you want to redirect
      // it to another service...see below.
      res.json(echo)
      
      /******************** PUT PLUGIN HOOKS BELOW HERE **********************/
      
      // For example, to pipe to Bazaarvoice, include it from plugins directory
      // var bv = require(path.resolve(__dirname, '..', 'plugins/bazaarvoice/bv.js'))
      
      // Now, just pipe the echo object and be sure to pass the
      // response object as well.
      // bv.pipeToBv(echo, res)

      // IMPORTANT: Since we are passing the 'res' object here, you need
      // to comment it out or remove it above (the res.json(echo) line).


      /******************** PUT PLUGIN HOOKS ABOVE HERE **********************/

      
    }) // end fs.exists
    
  }) // end ws.close()  

  // If request wants to delete then...
  if(req.body.timeToDie){
  
    setTimeout( function(){
      fs.unlink( echo.fullPhotoPath )
    }, parseInt(req.body.timeToDie)*1000 )
  
  } // end if timeToDie
  
} // end inbound route


/*
 * GET instagram page.
 */

exports.instagram = function(req, res){
  
  if(req.query.error === 'true'){
    return res.render('error', {type: 'instagram', title: 'PhotoPipe - Error!'})
  }
  
  if(!req.session.instagram){
    
    // Protip: Use a space when specifying various scope descriptors
    var auth_url = Instagram.oauth.authorization_url({
      scope: 'basic', 
      display: 'touch'
    })

    res.render('instagram', { 
        title: 'PhotoPipe - Instagram OAuth'
      , auth_url: auth_url})
    
  }
  else{

    // Let's grab the user's recent photos from their feed.
    Instagram.set('access_token', req.session.instagram.access_token)

    Instagram.users.recent({ 
      user_id: req.session.instagram.user.id, 
      complete: function(data){
        
        // TODO: ADD PAGINATION
        
        res.render('instagram-user', { 
            title: 'PhotoPipe - Hello '+ req.session.instagram.user.username,
            username: req.session.instagram.user.username,
            media: JSON.stringify(data)
          })
          
          // unset access_token --> 
          // this is probably pretty bad in practice actually (race conditions)
          Instagram.set('access_token', null)
          
      } // end complete 
    
    }) // end recent

  } // end else

} // end instagram route

/*
 * GET instagram oauth page.
 */

exports.instagram_oauth = function(req,res){
  
  Instagram.oauth.ask_for_access_token({
      request: req,
      response: res,
      complete: function(params, response){
        
        // Set the JSON object response to the _user object
        // for access later...
        req.session.instagram = params
        
        // Head back to instagram page, but this time, we'll enter
        // the else block because we have an Instagram._user object
        return res.redirect('/instagram')

      },
      error: function(errorMessage, errorObject, caller, response){
        // errorMessage is the raised error message
        // errorObject is either the object that caused the issue, or the nearest neighbor
        res.redirect('/instagram?error=true')
      }
    })
    return null
}


/*
 * GET facebook oauth page.
 */

exports.facebook = function(req, res){
  
  if(req.query.error === 'true'){
    return res.render('error', {type: 'facebook', title: 'PhotoPipe - Error!'})
  }

  if(!req.session.facebook){
    
    // You may want to modify the scope here, but what is listed
    // below is required for PhotoPipe

    res.render('facebook', {
      title: 'PhotoPipe - Facebook OAuth',
      auth_url: 'https://www.facebook.com/dialog/oauth?client_id='+Facebook.config.client_id
                +'&redirect_uri='+Facebook.config.redirect_uri
                +'&scope=user_photos,photo_upload,publish_stream'
                +'&state='+new Date
    })

  }
  else{
    
    // console.log('Access Token: %s', req.session.facebook.access_token)

    // Fetch profile from graph API
    request.get('https://graph.facebook.com/me?access_token='+req.session.facebook.access_token, function(e,r,b){

      if(e) return res.render('error', {type: 'facebook', title: 'PhotoPipe - Error!'})
      
      var fbJson = JSON.parse(b)
      
      // console.dir(fbJson)

      req.session.facebook.username = fbJson.username
      req.session.facebook.name = fbJson.name
      req.session.facebook.id = fbJson.id
      
      // Get the photo albums
      getFbPhotoAlbums(req,res,function(err,data){
        
        if(err){
          return res.render('error',{
              type: 'facebook', 
              title: 'PhotoPipe - Error!',
              fb_error: err
            }) // end res.render
        }
        
        res.render('facebook-user', { 
            title: 'PhotoPipe - Hello '+ req.session.facebook.name,
            username: req.session.facebook.name,
            media: JSON.stringify(data)
          })
        
        
      }) // end getFbPhotoAlbums

    }) // end request.get(fb-me)

   } // end else
  
} // end facebook route

/*
 * GET facebook photo album cover via cover photo ID.
 * 
 * 'cover_photo' param required
 * returns a string, does not render a page.
 */
exports.facebook_get_photo_album_cover = function(req,res){
  
  if(!req.session.facebook || !req.session.facebook.access_token) return res.redirect('/facebook')
  
  var coverImgId = req.query.cover_photo

  request.get('https://graph.facebook.com/'+coverImgId
              +'?access_token='+req.session.facebook.access_token, function(e,r,b){
    
    if(e){
      res.type('text/plain')
      return res.send('/img/pipe-75x75.png')
    }
    
    var fbImagesJson = JSON.parse(b)

    var theImg = fbImagesJson.picture || fbImagesJson.source // source is larger size

    if(!theImg){
      res.type('text/plain')
      return res.send('/img/pipe-75x75.png')
    }

    res.type('text/plain') 
    return res.send(theImg)
    
  }) // request.get(fb-album-cover)
  
}

/*
 * GET facebook photos from an album's ID.
 * 
 * 'id' param required
 * returns a JSON, does not render a page.
 */

exports.facebook_get_photos_from_album_id = function(req,res){
  
  if(!req.session.facebook || !req.session.facebook.access_token) return res.redirect('/facebook')
  
  var galleryId = req.query.id
  
  if(!galleryId){
    res.type('text/plain')
    return res.status('404').send("No album ID present in request.")
  }

  request.get('https://graph.facebook.com/'
              +galleryId+'/photos?access_token='+req.session.facebook.access_token, function(e,r,b){
    
    if(e){
      res.type('text/plain')
      return res.status('404').send(e)
    }
    
    var fbImagesJson = JSON.parse(b)

    if(!fbImagesJson.data){
      return res.json({message: "Unable to grab photos for gallery."})
    }

    return res.json(fbImagesJson)
    
  }) // request.get(fb-album-cover)
  
}

/*
 * GET facebook user's albums.
 * 
 * returns a JSON, does not render a page.
 */
exports.facebook_get_photo_albums = function(req,res){
  
  if(!req.session.facebook || !req.session.facebook.access_token) return res.redirect('/facebook')
  
  getFbPhotoAlbums(req,res)
              
} // end facebook_get_photo_albums handler


// if cb does not exist, then we just need to marshall back the json
function getFbPhotoAlbums(req,res,cb){
  
  // Fetch user's albums (so these are typically photos they have uploaded)
  request.get('https://graph.facebook.com/'+req.session.facebook.id
              +'/albums?access_token='+req.session.facebook.access_token, function(e,r,b){

                // If this is a request to the server directly,
                // then there should be no callback
                if(typeof cb !== 'function'){

                  if(e){
                    res.type('text/plain')
                    return res.status('404').send(e)
                  }

                  var fbAlbumsJson = JSON.parse(b)

                  res.json(fbAlbumsJson.data)
                  
                }else{

                  if(e){
                    return cb(e,null)
                  }else{
                    var fbAlbumsJson = JSON.parse(b)
                    cb(null, fbAlbumsJson.data)
                  }

                } // end outer else isRequest
                
              }) // request.get(fb-albums)
  
}

/*
 * GET facebook photos a user is tagged in.
 * 
 * returns a JSON, does not render a page.
 */
exports.facebook_get_tagged_in_photos = function(req,res){
  
  if(!req.session.facebook || !req.session.facebook.access_token) return res.redirect('/facebook')
  
  // Fetch user's photos, NOT their albums (so these are typically photos they are tagged in)
  
  request.get('https://graph.facebook.com/me/photos?access_token='
              +req.session.facebook.access_token, function(e,r,b){
                
                if(e) {
                  res.type('text/plain')
                  return res.status('404').send(e)
                }

                var fbImagesJson = JSON.parse(b)

                return res.json(fbImagesJson.data)
                
              }) // request.get(fb-tagged-photos)
  
} // end facebook_get_tagged_in_photos handler

/*
 * GET facebook oauth page.
 */

exports.facebook_oauth = function(req,res){
  
  // https://developers.facebook.com/docs/authentication/server-side/
  
  if(req.query && req.query.code){
    
    // Handle initial code response
    
    var code = req.query.code
    
    request.get('https://graph.facebook.com/oauth/access_token?client_id='+Facebook.config.client_id
       +'&redirect_uri=http://photopi.pe/oauth/facebook'
       +'&client_secret='+Facebook.config.client_secret
       +'&code='+code, function(e,r,b){
         if(e) return res.send(e)
         
         var parseQs = qs.parse(b)
         
         req.session.facebook = {
           access_token: parseQs.access_token,
           expires: parseQs.expires
         }
         res.redirect('/facebook')
       })
    
  }
  else if(req.query && req.query.error){
    
    // Handle deny auth case
    
    return res.render('error', {
      type: 'facebook', 
      title: 'PhotoPipe - Error!',
      fb_error:{
          error_reason: req.query.error_reason,
          error: req.query.error,
          error_description: req.query.error_description
        } 
      }) // end res.render
      
  } // end else if
  
} // end facebook_oauth handler