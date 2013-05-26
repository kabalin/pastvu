/*global define:true*/
/**
 * Модель профиля пользователя
 */
define(['underscore', 'underscore.string', 'Utils', '../../socket', 'Params', 'knockout', 'knockout.mapping', 'm/_moduleCliche', 'globalVM', 'renderer', 'moment', 'model/Photo', 'model/storage', 'text!tpl/photo/photo.jade', 'css!style/photo/photo', 'bs/bootstrap-tooltip', 'bs/bootstrap-popover', 'bs/bootstrap-dropdown', 'bs/bootstrap-multiselect', 'knockout.bs', 'jquery-plugins/scrollto', 'jquery-plugins/imgareaselect'], function (_, _s, Utils, socket, P, ko, ko_mapping, Cliche, globalVM, renderer, moment, Photo, storage, jade) {
	'use strict';

	/**
	 * Редактирование содержимого элементов с помошью contenteditable
	 * Inspired by https://groups.google.com/forum/#!topic/knockoutjs/Mh0w_cEMqOk
	 * @type {Object}
	 */
	ko.bindingHandlers.cEdit = {
		init: function (element, valueAccessor, allBindingsAccessor) {
		},
		update: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
			var obj = ko.utils.unwrapObservable(valueAccessor()),
				$element = $(element);

			$element.text(ko.isWriteableObservable(obj.val) ? obj.val() : obj.val);

			if (obj.edit) {
				if (!$element.attr('contenteditable')) {
					$element
						.css({display: ''})
						.attr('contenteditable', "true")
						.on('blur', function () {
							console.log('blur');
							var modelValue = obj.val,
								elementValue = $.trim($element.text());

							$element.text(elementValue);
							if (ko.isWriteableObservable(modelValue)) {
								if (elementValue === modelValue()) {
									checkForCap();
								} else {
									modelValue(elementValue);
								}
							}
						})
						.on('focus', function () {
							console.log('focus');
							$element.removeClass('cap');
							if (_.isEmpty(String(ko.isWriteableObservable(obj.val) ? obj.val() : obj.val))) {
								$element.html('&nbsp;');
							}
						});
					checkForCap();
				} else {
					checkForCap();
				}
			} else {
				if ($element.attr('contenteditable') === 'true') {
					$element.off('blur').off('focus').removeAttr('contenteditable').removeClass('cap');
				}
				if (_.isEmpty(String(ko.isWriteableObservable(obj.val) ? obj.val() : obj.val))) {
					$element.css({display: 'none'});
				}
			}

			function checkForCap() {
				if (obj.edit && obj.cap && _.isEmpty(String(ko.isWriteableObservable(obj.val) ? obj.val() : obj.val))) {
					$element.addClass('cap');
					$element.text(obj.cap);
				} else {
					$element.removeClass('cap');
				}
			}
		}
	};

	return Cliche.extend({
		jade: jade,
		create: function () {
			var _this = this,
				mapModuleDeffered = new $.Deferred(),
				mapReadyDeffered = new $.Deferred();

			this.auth = globalVM.repository['m/common/auth'];
			this.p = Photo.vm(Photo.def.full);

			this.photoSrc = ko.observable('');
			this.photoLoading = ko.observable(true);
			this.photoLoadContainer = null;

			this.userRibbon = ko.observableArray();
			this.userRibbonLeft = [];
			this.userRibbonRight = [];
			this.exe = ko.observable(false); //Указывает, что сейчас идет обработка запроса на действие к серверу

			this.IOwner = this.co.IOwner = ko.computed(function () {
				return this.auth.iAm.login() === this.p.user.login();
			}, this);
			this.IAdmin = this.co.IAdmin = ko.computed(function () {
				return this.auth.loggedIn() && this.auth.iAm.role_level() >= 0;
			}, this);

			this.canBeEdit = this.co.canBeEdit = ko.computed(function () {
				return this.IOwner() || this.IAdmin();
			}, this);

			this.canBeApprove = this.co.canBeApprove = ko.computed(function () {
				return this.p.fresh() && this.IAdmin();
			}, this);

			this.canBeDisable = this.co.canBeDisable = ko.computed(function () {
				return !this.p.fresh() && this.IAdmin();
			}, this);

			this.canBeRemove = this.co.canBeRemove = ko.computed(function () {
				return this.IAdmin();
			}, this);

			this.canBeConvert = this.co.canBeConvert = ko.computed(function () {
				return this.IAdmin();
			}, this);

			this.edit = ko.observable(undefined);

			this.msg = ko.observable('');
			this.msgCss = ko.observable('');

			this.msgByStatus = this.co.msgByStatus = ko.computed(function () {
				if (this.edit()) {
					this.setMessage('Photo is in edit mode. Please fill in the underlying fields and save the changes', 'warn');
					//globalVM.pb.publish('/top/message', ['Photo is in edit mode. Please fill in the underlying fields and save the changes', 'warn']);
				} else if (this.p.fresh()) {
					this.setMessage('Photo is new. Administrator must approve it', 'warn');
				} else if (this.p.disabled()) {
					this.setMessage('Photo is disabled by Administrator. Only You and other Administrators can see and edit it', 'warn');
				} else if (this.p.del()) {
					this.setMessage('Photo is deleted by Administrator', 'warn');
				} else {
					this.setMessage('', 'muted');
				}
			}, this);

			this.userInfo = this.co.userInfo = ko.computed(function () {
				return _.template(
					'Added by <a target="_self" href="/u/${ login }">${ name }</a> at ${ stamp }<br/>Viewed today ${ sd } times, week ${ sw } times, total ${ sa } times',
					{ login: this.p.user.login(), name: this.p.user.fullName(), stamp: moment(this.p.ldate()).format('D MMMM YYYY'), sd: this.p.vdcount(), sw: this.p.vwcount(), sa: this.p.vcount()}
				);
			}, this);

			this.ws = ko.observable(Photo.def.full.ws);
			this.hs = ko.observable(Photo.def.full.hs);
			this.hscalePossible = ko.observable(false);
			this.hscaleTumbler = ko.observable(true);
			this.thumbW = ko.observable('0px');
			this.thumbH = ko.observable('0px');
			this.thumbM = ko.observable('1px');
			this.userThumbN = ko.observable(3);

			this.convertOptions = ko.observableArray([
				/*{vName: 'Origin', id: 'origin'}, */{vName: 'Standard', vId: 'standard'},
				{vName: 'Thumb', vId: 'thumb'},
				{vName: 'Midi', vId: 'midi'},
				{vName: 'Mini', vId: 'mini'},
				{vName: 'Micro', vId: 'micro'},
				{vName: 'Micros', vId: 'micros'}
			]);
			this.selectedOpt = ko.observableArray([]);
			this.$dom.find('#convertSelect').multiselect({
				buttonClass: 'btn-strict',
				buttonWidth: 'auto', // Default
				buttonText: function (options) {
					if (options.length === 0) {
						return 'Convert variants <b class="caret"></b>';
					} else if (options.length === _this.convertOptions().length) {
						return 'All variants selected <b class="caret"></b>';
					} else if (options.length > 2) {
						return options.length + ' variants selected <b class="caret"></b>';
					} else {
						var selected = '';
						options.each(function () {
							selected += $(this).text() + ', ';
						});
						return selected.substr(0, selected.length - 2) + ' <b class="caret"></b>';
					}
				}
			});

			this.commentsLoading = ko.observable(false);
			this.commentsInViewport = false;

			this.scrollTimeout = null;
			this.commentsRecieveTimeout = null;
			this.commentsViewportTimeout = null;

			this.$comments = this.$dom.find('.photoComments');

			this.commentsRecieveBind = this.commentsRecieve.bind(this);
			this.commentsCheckInViewportBind = this.commentsCheckInViewport.bind(this);
			this.viewScrollHandleBind = this.viewScrollHandle.bind(this);
			this.scrollToBind = this.scrollTo.bind(this);

			this.fraging = ko.observable(false);
			this.commentFragArea = null;

			this.mapVM = null;
			this.mapModulePromise = mapModuleDeffered.promise();
			this.childs = [
				{
					module: 'm/map/map',
					container: '.photoMap',
					options: {embedded: true, editing: this.edit(), deferredWhenReady: mapReadyDeffered},
					ctx: this,
					callback: function (vm) {
						this.mapVM = this.childModules[vm.id] = vm;
						$.when(mapReadyDeffered.promise()).done(function () {
							mapModuleDeffered.resolve();
						}.bind(this));
					}
				},
				{
					module: 'm/comment/comments',
					container: '.photoCommentsContainer',
					options: {type: 'photo', autoShowOff: true},
					ctx: this,
					callback: function (vm) {
						this.commentsVM = this.childModules[vm.id] = vm;
						// Так как при первом заходе, когда модуль еще не зареквайрен, нужно вызвать самостоятельно, а последующие будут выстреливать сразу
						this.routeHandler();
					}
				}
			];

			ko.applyBindings(globalVM, this.$dom[0]);

			// Вызовется один раз в начале 700мс и в конце один раз, если за эти 700мс были другие вызовы
			this.routeHandlerDebounced = _.throttle(this.routeHandler, 700, {leading: true, trailing: true});

			// Subscriptions
			this.subscriptions.route = globalVM.router.routeChanged.subscribe(this.routeHandlerDebounced, this);
			this.subscriptions.edit = this.edit.subscribe(this.editHandler, this);
			if (!this.auth.loggedIn()) {
				this.subscriptions.loggedIn = this.auth.loggedIn.subscribe(this.loggedInHandler, this);
			}
			this.subscriptions.sizes = P.window.square.subscribe(this.sizesCalc, this);
			this.subscriptions.hscaleTumbler = this.hscaleTumbler.subscribe(this.sizesCalcPhoto, this);
			this.subscriptions.year = this.p.year.subscribe(function (val) {
				var v = Number(val);

				if (!v || isNaN(v)) {
					//Если значение не парсится, ставим дефолтное
					v = Photo.def.full.year;
				} else {
					//Убеждаемся, что оно в допустимом интервале
					v = Math.min(Math.max(v, 1826), 2000);
				}

				if (String(val) !== String(v)) {
					//Если мы поправили значение, то перезаписываем его
					this.p.year(v);
				} else if (v > parseInt(this.p.year2(), 10)) {
					this.p.year2(v);
				}
			}, this);
			this.subscriptions.year2 = this.p.year2.subscribe(_.debounce(function (val) {
				var v = Number(val);

				if (!v || isNaN(v)) {
					//Если значение не парсится, ставим дефолтное
					v = Photo.def.full.year;
				} else {
					//Убеждаемся, что оно в допустимом интервале и не мене year
					v = Math.min(Math.max(v, this.p.year()), 2000);
				}

				if (String(val) !== String(v)) {
					this.p.year2(v);
				}
			}, 400), this);
		},
		show: function () {
			if (this.showing) {
				return;
			}

			var $wrap = this.$dom.find('.photoImgWrap');
			$wrap
				.on('mouseenter', 'a.photoFrag', function (evt) {
					var frag = $(evt.target),
						fragOffset = frag.offset(),
						fragPosition = frag.position(),
						fragWidth = frag.width(),
						$comment = $(".media[data-cid=" + frag.attr('data-cid') + "]"),
						placement;

					if ($comment.length === 1) {
						$wrap.addClass('fragHover');
						$wrap.find('.photoImg').imgAreaSelect({
							classPrefix: 'photoFragAreaShow imgareaselect',
							x1: fragPosition.left, y1: fragPosition.top, x2: fragPosition.left + fragWidth + 2, y2: fragPosition.top + frag.height() + 2,
							zIndex: 1,
							parent: $wrap, disable: true
						});

						if (fragOffset.left + fragWidth / 2 < 150) {
							placement = 'right';
						} else if ($(evt.delegateTarget).width() - fragOffset.left - fragWidth / 2 < 150) {
							placement = 'left';
						} else {
							placement = 'bottom';
						}
						frag
							.popover({title: $comment.find('.author').html(), content: $comment.find('.commentText').html(), placement: placement, html: true, delay: 0, animation: false, trigger: 'manual'})
							.popover('show');
					}
				}.bind(this))
				.on('mouseleave', '.photoFrag', function (evt) {
					var frag = $(evt.target);
					frag.popover('destroy');
					$wrap.find('.photoImg').imgAreaSelect({remove: true});
					$wrap.removeClass('fragHover');
				});

			globalVM.func.showContainer(this.$container);
			this.sizesCalc();
			this.showing = true;
		},
		hide: function () {
			globalVM.func.hideContainer(this.$container);
			this.showing = false;
			//globalVM.pb.publish('/top/message', ['', 'muted']);
		},

		sizesCalc: function () {
			var rightPanelW = this.$dom.find('.rightPanel').width(),
				thumbW,
				thumbH,
				thumbWV1 = 84,
				thumbWV2 = 90,
				thumbMarginMin = 1,
				thumbMargin,
				thumbNMin = 3,
				thumbNV1,
				thumbNV2;

			thumbNV1 = Math.max(thumbNMin, (rightPanelW + thumbMarginMin) / (thumbWV1 + thumbMarginMin) >> 0);
			thumbNV2 = Math.max(thumbNMin, (rightPanelW + thumbMarginMin) / (thumbWV2 + thumbMarginMin) >> 0);

			if (thumbNV1 === thumbNV2) {
				thumbW = thumbWV2;
			} else {
				thumbW = thumbWV1;
			}

			thumbH = thumbW / 1.5 >> 0;
			thumbMargin = (rightPanelW - thumbNV1 * thumbW) / (thumbNV1 - 1) >> 0;

			this.thumbW(thumbW + 'px');
			this.thumbH(thumbH + 'px');
			this.thumbM(thumbMargin + 'px');
			this.userThumbN(thumbNV1);

			this.sizesCalcPhoto();

			this.applyUserRibbon();

			rightPanelW = thumbW = thumbH = null;
		},
		sizesCalcPhoto: function () {
			var maxWidth = this.$dom.find('.photoPanel').width() >> 0,
				maxHeight = P.window.h() - this.$dom.find('.photoImgRow').offset().top - 47 >> 0,
				ws = this.p.ws(),
				hs = this.p.hs(),
				aspect = ws / hs,
				fragSelection;

			// Подгоняем по максимальной ширине
			if (ws > maxWidth) {
				ws = maxWidth;
				hs = Math.round(ws / aspect);
			}

			// Если устанавливаемая высота больше максимальной высоты,
			// то делаем возможным hscale и при влюченном тумблере hscale пересчитываем высоту и ширину
			if (hs > maxHeight) {
				this.hscalePossible(true);
				if (this.hscaleTumbler()) {
					hs = maxHeight;
					ws = Math.round(hs * aspect);
				}
			} else {
				this.hscalePossible(false);
			}

			this.ws(ws);
			this.hs(hs);

			if (this.commentFragArea instanceof $.imgAreaSelect) {
				fragSelection = this.fragAreaSelection();
				this.fragAreaDelete();
				this.fragAreaCreate(fragSelection);
			}
		},
		stateChange: function (data, event) {
			var state = $(event.currentTarget).attr('data-state');
			if (state && this[state]) {
				this[state](!this[state]());
			}
		},

		routeHandler: function () {
			var cid = Number(globalVM.router.params().cid),
				hl = globalVM.router.params().hl,
				appHistory = globalVM.router.getFlattenStack('/p/', ''),
				offset = globalVM.router.offset;

			this.toComment = this.toFrag = undefined;
			window.clearTimeout(this.scrollTimeout);

			if (hl) {
				if (hl.indexOf('comment-') === 0) {
					this.toComment = parseInt(hl.substr(8), 10) || undefined;
				} else if (hl.indexOf('frag-') === 0) {
					this.toFrag = parseInt(hl.substr(5), 10) || undefined;
				}
			}

			if (this.p && Utils.isType('function', this.p.cid) && this.p.cid() !== cid) {
				this.photoLoading(true);

				this.commentsVM.clear();
				this.commentsLoading(false);
				this.commentsInViewport = false;

				this.viewScrollOff();
				window.clearTimeout(this.commentsRecieveTimeout);
				window.clearTimeout(this.commentsViewportTimeout);

				storage.photo(cid, function (data) {
					var editMode; // Если фото новое и пользователь - владелец, открываем его на редактирование
					if (data) {
						this.originData = data.origin;
						this.p = Photo.vm(data.origin, this.p, true);
						editMode = this.p.fresh() && this.IOwner();

						Utils.title.setTitle({title: this.p.title()});

						if (this.photoLoadContainer) {
							this.photoLoadContainer.off('load').off('error');
						}
						this.photoLoadContainer = $(new Image())
							.on('load', this.onPhotoLoad.bind(this))
							.on('error', this.onPhotoError.bind(this))
							.attr('src', this.p.sfile());

						this.getUserRibbon(7, 7, this.applyUserRibbon, this);

						this.commentsVM.setCid(cid);
						//Если не редактирование и есть комментарии, то откладываем их активацию,
						//в противном случае в editHandler активируется немедленно
						if (!editMode && this.p.ccount() > 0) {
							this.commentsActivate(this.p.ccount() > 30 ? 500 : 300);
						}

						this.changePhotoHandler(); // Вызываем обработчик изменения фото (this.p)
						this.show();
						this.edit(editMode);
					}
				}, this, this.p);
			} else if (this.toFrag || this.toComment) {
				this.scrollTimeout = window.setTimeout(this.scrollToBind, 50);
			}

		},
		loggedInHandler: function () {
			// После логина перезапрашиваем ленту фотографий пользователя
			this.getUserRibbon(7, 7, this.applyUserRibbon, this);
			this.subscriptions.loggedIn.dispose();
			delete this.subscriptions.loggedIn;
		},
		editHandler: function (v) {
			if (v) {
				$.when(this.mapModulePromise).done(this.mapEditOn.bind(this));
				this.commentsVM.hide();
			} else {
				$.when(this.mapModulePromise).done(this.mapEditOff.bind(this));
				//Если не ожается проверка на комментарии в видимой области (а она ожидается при открытии фото),
				//то вызываем её немедленно
				this.commentsActivate();
			}
		},
		mapEditOn: function () {
			this.mapVM.editPointOn();
		},
		mapEditOff: function () {
			this.mapVM.editPointOff();
		},
		// Обработчик изменения фото
		changePhotoHandler: function () {
			$.when(this.mapModulePromise).done(this.setMapPoint.bind(this));
		},
		// Установить точку на карту
		setMapPoint: function () {
			this.mapVM.setPoint(this.p);
		},

		editSave: function (/*data, event*/) {
			if (this.canBeEdit()) {
				if (!this.edit()) {
					this.edit(true);
				} else {
					this.exe(true);
					this.p.geo(this.mapVM.getPointGeo());
					this.save(function (data) {
						if (!data.error) {
							this.edit(false);
							this.setMapPoint();
						} else {
							window.noty({text: data.message || 'Error occurred', type: 'error', layout: 'center', timeout: 2000, force: true});
						}
						this.exe(false);
					}, this);

				}
			}
		},
		editCancel: function (data, event) {
			if (this.canBeEdit() && this.edit()) {
				this.cancel();
				this.edit(false);
			}
		},
		setApprove: function (data, event) {
			if (this.canBeApprove()) {
				this.exe(true);
				socket.once('approvePhotoResult', function (data) {
					if (data && !data.error) {
						this.p.fresh(false);
						this.originData.fresh = false;
					} else {
						window.noty({text: data.message || 'Error occurred', type: 'error', layout: 'center', timeout: 2000, force: true});
					}
					this.exe(false);
				}.bind(this));
				socket.emit('approvePhoto', this.p.cid());
			}
		},
		toggleDisable: function (data, event) {
			if (this.canBeDisable()) {
				this.exe(true);
				socket.once('disablePhotoResult', function (data) {
					if (data && !data.error) {
						this.p.disabled(data.disabled || false);
						this.originData.disabled = data.disabled || false;
					} else {
						window.noty({text: data.message || 'Error occurred', type: 'error', layout: 'center', timeout: 2000, force: true});
					}
					this.exe(false);
				}.bind(this));
				socket.emit('disablePhoto', this.p.cid());
			}
		},

		remove: function (data, event) {
			if (!this.canBeRemove()) {
				return false;
			}

			var that = this;

			this.exe(true);
			window.noty(
				{
					text: 'The photo will be removed permanently.<br>Confirm the delete operation?',
					type: 'confirm',
					layout: 'center',
					modal: true,
					force: true,
					animation: {
						open: {height: 'toggle'},
						close: {},
						easing: 'swing',
						speed: 500
					},
					buttons: [
						{addClass: 'btn-strict btn-strict-danger', text: 'Ok', onClick: function ($noty) {
							// this = button element
							// $noty = $noty element
							if ($noty.$buttons && $noty.$buttons.find) {
								$noty.$buttons.find('button').attr('disabled', true).addClass('disabled');
							}

							socket.once('removePhotoCallback', function (data) {
								$noty.$buttons.find('.btn-strict-danger').remove();
								var okButton = $noty.$buttons.find('button')
									.attr('disabled', false)
									.removeClass('disabled')
									.off('click');

								if (data && !data.error) {
									this.p.del(true);
									this.originData.del = true;

									$noty.$message.children().html('Photo successfully removed');

									okButton.text('Ok (4)').on('click', function () {
										document.location.href = '/u/' + this.p.user.login() + '/photo';
									}.bind(this));

									Utils.timer(
										5000,
										function (timeleft) {
											okButton.text('Ok (' + timeleft + ')');
										},
										function () {
											okButton.trigger('click');
										}
									);
								} else {
									$noty.$message.children().html(data.message || 'Error occurred');
									okButton.text('Close').on('click', function () {
										$noty.close();
										this.exe(false);
									}.bind(this));
								}
							}.bind(that));
							socket.emit('removePhoto', that.p.cid());

						}},
						{addClass: 'btn-strict', text: 'Cancel', onClick: function ($noty) {
							$noty.close();
							that.exe(false);
						}}
					]
				}
			);
		},
		save: function (cb, ctx) {
			var target = _.pick(ko_mapping.toJS(this.p), 'geo', 'dir', 'title', 'year', 'year2', 'address', 'desc', 'source', 'author'),
				key;

			for (key in target) {
				if (target.hasOwnProperty(key)) {
					if (!_.isUndefined(this.originData[key]) && _.isEqual(target[key], this.originData[key])) {
						delete target[key];
					} else if (_.isUndefined(this.originData[key]) && _.isEqual(target[key], Photo.def.full[key])) {
						delete target[key];
					}
				}
			}

			if (target.geo) {
				target.geo.reverse();
			}
			if (Utils.getObjectPropertyLength(target) > 0) {
				target.cid = this.p.cid();
				socket.once('savePhotoResult', function (data) {
					if (data && !data.error) {
						if (target.geo) {
							target.geo.reverse();
						}
						_.assign(this.originData, target);
					}
					if (cb) {
						cb.call(ctx, data);
					}
				}.bind(this));
				socket.emit('savePhoto', target);
			} else {
				if (cb) {
					cb.call(ctx, {message: 'Nothing to save'});
				}
			}
		},
		cancel: function () {
			_.forEach(this.originData, function (item, key) {
				if (Utils.isType('function', this.p[key]) && this.p[key]() !== item) {
					this.p[key](item);
				}
			}.bind(this));
		},

		toConvert: function (data, event) {
			if (!this.canBeConvert() || this.selectedOpt().length === 0) {
				return false;
			}
			this.exe(true);
			socket.once('convertPhotosResult', function (data) {
				if (data && !data.error) {
					window.noty({text: data.message || 'OK', type: 'success', layout: 'center', timeout: 1000, force: true});
				} else {
					window.noty({text: (data && data.message) || 'Error occurred', type: 'error', layout: 'center', timeout: 2000, force: true});
				}
				this.exe(false);
			}.bind(this));
			socket.emit('convertPhotos', [
				{file: this.p.file(), variants: this.selectedOpt()}
			]);
		},

		getUserRibbon: function (left, right, cb, ctx) {
			socket.once('takeUserPhotosAround', function (data) {
				if (!data || data.error) {
					console.error('While loading user ribbon: ', data.message || 'Error occurred');
				} else {
					var left = [],
						right = [];
					if (data.left && data.left.length > 0) {
						data.left.reverse();
						data.left.forEach(function (item) {
							var existItem = _.find(this.userRibbonLeft, function (element) {
								return element.cid === item.cid;
							});
							if (existItem) {
								left.push(existItem);
							} else {
								Photo.factory(item, 'base', 'mini');
								left.push(item);
							}
						}, this);
					}
					this.userRibbonLeft = left;
					if (data.right && data.right.length > 0) {
						data.right.forEach(function (item) {
							var existItem = _.find(this.userRibbonRight, function (element) {
								return element.cid === item.cid;
							});
							if (existItem) {
								right.push(existItem);
							} else {
								Photo.factory(item, 'base', 'mini');
								right.push(item);
							}
						}, this);
					}
					this.userRibbonRight = right;
				}
				if (Utils.isType('function', cb)) {
					cb.call(ctx, data);
				}
			}.bind(this));
			socket.emit('giveUserPhotosAround', {cid: this.p.cid(), limitL: left, limitR: right});
		},
		applyUserRibbon: function (cb, ctx) {
			var n = this.userThumbN(),
				nLeft = Math.min(Math.max(Math.ceil(n / 2), n - this.userRibbonRight.length), this.userRibbonLeft.length),
				newRibbon = this.userRibbonLeft.slice(-nLeft);

			Array.prototype.push.apply(newRibbon, this.userRibbonRight.slice(0, n - nLeft));
			this.userRibbon(newRibbon);
			n = nLeft = newRibbon = null;
		},

		/**
		 * COMMENTS
		 */
		viewScrollOn: function () {
			$(window).on('scroll', this.viewScrollHandleBind);
		},
		viewScrollOff: function () {
			$(window).off('scroll', this.viewScrollHandleBind);
		},
		viewScrollHandle: function () {
			if (!this.commentsInViewport) {
				this.commentsCheckInViewport();
			}
		},
		commentsActivate: function (checkTimeout) {
			if (!this.commentsViewportTimeout) {
				this.commentsLoading(true);
				this.viewScrollOn();
				this.commentsViewportTimeout = window.setTimeout(this.commentsCheckInViewportBind, checkTimeout || 10);
			}
		},
		commentsCheckInViewport: function () {
			window.clearTimeout(this.commentsViewportTimeout);

			var cTop = this.$comments.offset().top,
				wTop = $(window).scrollTop(),
				wFold = $(window).height() + wTop;

			if (this.toComment || this.p.frags().length > 0 || cTop < wFold) {
				this.commentsInViewport = true;
				this.viewScrollOff();
				this.commentsGet();
			}
		},
		commentsGet: function () {
			window.clearTimeout(this.commentsRecieveTimeout);
			this.commentsRecieveTimeout = window.setTimeout(this.commentsRecieveBind, this.p.ccount() > 30 ? 750 : 400);
		},
		commentsRecieve: function () {
			this.commentsVM.recieve(this.p.cid(), function () {
				this.commentsLoading(false);
				this.commentsVM.show();
				this.scrollTimeout = window.setTimeout(this.scrollToBind, 100);
			}, this);
		},

		scrollTo: function () {
			if (this.toFrag) {
				this.commentsVM.highlightOff();
				this.scrollToFrag(this.toFrag);
			} else if (this.toComment) {
				this.highlightFragOff();
				this.commentsVM.scrollTo(this.toComment);
			}
		},
		scrollToFrag: function (frag) {
			var element = $('.photoFrag[data-cid="' + frag + '"]');

			if (element && element.length === 1) {
				this.highlightOff();
				$(window).scrollTo(element, {duration: 400, onAfter: function () {
					this.highlightFrag(frag);
				}}.bind(this));
			}
			return element;
		},
		highlightFrag: function (frag) {
			this.$dom.find('.photoFrag[data-cid="' + frag + '"]').addClass('hl');
		},
		highlightFragOff: function () {
			this.$dom.find('.photoFrag.hl').removeClass('hl');
		},

		commentCountIncrement: function (delta) {
			this.p.ccount(this.p.ccount() + delta);
		},
		commentAdd: function () {
			this.commentsVM.replyZero();
		},

		fragAreaCreate: function (selections) {
			if (!this.commentFragArea) {
				var $parent = this.$dom.find('.photoImgWrap'),
					ws = this.p.ws(), hs = this.p.hs(),
					ws2, hs2;

				if (!selections) {
					ws2 = ws / 2 >> 0;
					hs2 = hs / 2;
					selections = {x1: ws2 - 50, y1: hs2 - 50, x2: ws2 + 50, y2: hs2 + 50};
				}

				this.commentFragArea = $parent.find('.photoImg').imgAreaSelect(_.assign({
					classPrefix: 'photoFragAreaSelect imgareaselect',
					imageWidth: ws, imageHeight: hs,
					minWidth: 30, minHeight: 30,
					handles: true, parent: $parent, persistent: true, instance: true
				}, selections));
			}
			this.fraging(true);
		},
		fragAreaDelete: function () {
			if (this.commentFragArea instanceof $.imgAreaSelect) {
				this.commentFragArea.remove();
				this.$dom.find('.photoImg').removeData('imgAreaSelect');
				this.commentFragArea = null;
			}
			this.fraging(false);
		},
		fragAreaSelection: function (flag) {
			var result;
			if (this.commentFragArea instanceof $.imgAreaSelect) {
				this.commentFragArea.getSelection(flag);
			}
			return result;
		},
		fragAreaObject: function () {
			var selection,
				result;
			selection = this.fragAreaSelection(false);
			if (selection) {
				result = {
					l: 100 * selection.x1 / this.p.ws(),
					t: 100 * selection.y1 / this.p.hs(),
					w: 100 * selection.width / this.p.ws(),
					h: 100 * selection.height / this.p.hs()
				};
			}
			return result;
		},
		fragAdd: function (frag) {
			this.p.frags.push(ko_mapping.fromJS(frag));
		},
		fragEdit: function (ccid, options) {
			var frag = this.fragGetByCid(ccid),
				ws1percent = this.p.ws() / 100,
				hs1percent = this.p.hs() / 100;

			this.fragAreaCreate(_.assign({
				x1: frag.l() * ws1percent,
				y1: frag.t() * hs1percent,
				x2: frag.l() * ws1percent + frag.w() * ws1percent,
				y2: frag.t() * hs1percent + frag.h() * hs1percent
			}, options));
		},
		fragRemove: function (ccid) {
			this.p.frags.remove(this.fragGetByCid(ccid));
		},
		fragReplace: function (frags) {
			this.p.frags(ko_mapping.fromJS({arr: frags}).arr());
		},
		fragGetByCid: function (ccid) {
			return _.find(this.p.frags(), function (frag) {
				return frag.cid() === ccid;
			});
		},

		onPhotoLoad: function (event) {
			var img = event.target;
			// Если реальные размеры фото не соответствуют тем что в базе, используем реальные
			if (Utils.isType('number', img.width) && this.p.ws() !== img.width) {
				this.p.ws(img.width);
			}
			if (Utils.isType('number', img.height) && this.p.hs() !== img.height) {
				this.p.hs(img.height);
			}
			this.photoSrc(this.p.sfile());
			this.sizesCalcPhoto();
			this.photoLoadContainer = null;
			this.photoLoading(false);
		},
		onPhotoError: function (event) {
			this.photoSrc('');
			this.photoLoadContainer = null;
			this.photoLoading(false);
		},
		onImgLoad: function (data, event) {
			$(event.target).animate({opacity: 1});
			data = event = null;
		},
		onAvatarError: function (data, event) {
			$(event.target).attr('src', '/img/caps/avatar.png');
			data = event = null;
		},
		onThumbLoad: function (data, event) {
			$(event.target).parents('.photoTile').css({visibility: 'visible'});
			data = event = null;
		},
		onThumbError: function (data, event) {
			var $parent = $(event.target).parents('.photoTile');
			event.target.style.visibility = 'hidden';
			if (data.conv) {
				$parent.addClass('photoConv');
			} else if (data.convqueue) {
				$parent.addClass('photoConvqueue');
			} else {
				$parent.addClass('photoError');
			}
			$parent.animate({opacity: 1});
			data = event = $parent = null;
		},
		setMessage: function (text, type) {
			var css = '';
			switch (type) {
			case 'error':
				css = 'text-error';
				break;
			case 'warn':
				css = 'text-warning';
				break;
			case 'info':
				css = 'text-info';
				break;
			case 'success':
				css = 'text-success';
				break;
			default:
				css = 'muted';
				break;
			}

			this.msg(text);
			this.msgCss(css);

			text = type = css = null;
		}
	});
});